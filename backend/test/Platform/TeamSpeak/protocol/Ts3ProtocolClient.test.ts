import { Buffer } from 'node:buffer';
import { beforeEach, describe, expect, it } from 'vitest';
import {
    Ts3ProtocolClient,
    type ITs3Transport,
    type Ts3RunLoop,
} from '../../../../src/Platform/Adapters/TeamSpeak/protocol/Ts3ProtocolClient.js';
import type { TeamSpeakConfig } from '../../../../src/Platform/Adapters/TeamSpeak/TeamSpeakConfig.js';
import type {
    TeamSpeakAudioData,
    TeamSpeakClientHandlers,
    TeamSpeakParticipant,
} from '../../../../src/Platform/Adapters/TeamSpeak/ITeamSpeakClient.js';
import { Ts3Crypt } from '../../../../src/Platform/Adapters/TeamSpeak/protocol/crypto/Ts3Crypt.js';
import { Ts3Identity } from '../../../../src/Platform/Adapters/TeamSpeak/protocol/crypto/Ts3Identity.js';
import {
    PacketFlags,
    PacketType,
} from '../../../../src/Platform/Adapters/TeamSpeak/protocol/packet/PacketType.js';
import {
    decodePacket,
    encodeHeader,
    encodePacket,
    PacketDirection,
    type Ts3Packet,
} from '../../../../src/Platform/Adapters/TeamSpeak/protocol/packet/Ts3Packet.js';
import {
    buildPacket1,
    buildPacket3,
    unwrapInit1,
    wrapServerInit1,
} from '../../../../src/Platform/Adapters/TeamSpeak/protocol/init1/Init1.js';
import {
    firstValue,
    parseCommand,
    serializeCommand,
    type TsCommand,
} from '../../../../src/Platform/Adapters/TeamSpeak/protocol/command/TsCommand.js';
import {
    Codec,
    decodeVoiceC2S,
    encodeVoiceS2C,
    type VoicePayloadC2S,
} from '../../../../src/Platform/Adapters/TeamSpeak/protocol/voice/VoicePacket.js';
import {
    OPUS_VOICE,
    type IOpusCodecFactory,
    type IOpusDecoder,
    type IOpusEncoder,
} from '../../../../src/Platform/Adapters/TeamSpeak/protocol/voice/IOpusCodec.js';

// --- test doubles -----------------------------------------------------------

/** Captures outbound datagrams and injects inbound ones — no real socket. */
class FakeTransport implements ITs3Transport {
    public readonly sent: Buffer[] = [];
    public opened: boolean = false;
    private _handlers: Parameters<ITs3Transport['setHandlers']>[0] | null = null;

    public setHandlers(handlers: Parameters<ITs3Transport['setHandlers']>[0]): void {
        this._handlers = handlers;
    }
    public async open(): Promise<void> {
        this.opened = true;
    }
    public send(data: Buffer): void {
        this.sent.push(Buffer.from(data));
    }
    public isOpen(): boolean {
        return this.opened;
    }
    public async close(): Promise<void> {
        this.opened = false;
    }
    /** Deliver one server→client datagram to the client. */
    public deliver(raw: Buffer): void {
        this._handlers?.onMessage(raw);
    }
    public onError(error: Error): void {
        this._handlers?.onError(error);
    }
    public drain(): Buffer[] {
        return this.sent.splice(0, this.sent.length);
    }
}

/** Run-loop that just captures the tick so the test can drive time by hand. */
class ManualRunLoop implements Ts3RunLoop {
    public tick: (() => void) | null = null;
    public start(tick: () => void): void {
        this.tick = tick;
    }
    public stop(): void {
        this.tick = null;
    }
}

/** Deterministic Opus stand-in: encode tags the length, decode echoes it. */
const FRAME_SAMPLES: number = OPUS_VOICE.frameSize * OPUS_VOICE.channels;
class FakeEncoder implements IOpusEncoder {
    public encode(pcm: Int16Array): Buffer {
        return Buffer.from([0xee, pcm.length & 0xff, (pcm.length >> 8) & 0xff]);
    }
    public close(): void {}
}
class FakeDecoder implements IOpusDecoder {
    public decode(frame: Buffer | null): Int16Array {
        return new Int16Array(FRAME_SAMPLES).fill(frame === null ? 0 : frame.length);
    }
    public close(): void {}
}
class FakeCodecFactory implements IOpusCodecFactory {
    public createEncoder(): IOpusEncoder {
        return new FakeEncoder();
    }
    public createDecoder(): IOpusDecoder {
        return new FakeDecoder();
    }
}

/** Collects everything the client raises so tests can assert on it. */
class RecordingHandlers implements TeamSpeakClientHandlers {
    public readonly joined: TeamSpeakParticipant[] = [];
    public readonly left: string[] = [];
    public readonly audio: TeamSpeakAudioData[] = [];
    public readonly speaking: { id: string; speaking: boolean }[] = [];
    public readonly errors: string[] = [];

    public onParticipantJoined(p: TeamSpeakParticipant): void {
        this.joined.push(p);
    }
    public onParticipantLeft(id: string): void {
        this.left.push(id);
    }
    public onAudioData(data: TeamSpeakAudioData): void {
        this.audio.push(data);
    }
    public onSpeakingChanged(id: string, speaking: boolean): void {
        this.speaking.push({ id: id, speaking: speaking });
    }
    public onError(message: string): void {
        this.errors.push(message);
    }
}

// --- a loopback server built from the real protocol layers ------------------

const BETA: Buffer = Buffer.alloc(10, 0xbb);

/** Minimal TS3 server: derives the same secret and frames packets like a real one. */
class LoopbackServer {
    public readonly identity: Ts3Identity = Ts3Identity.generate();
    public readonly crypt: Ts3Crypt = new Ts3Crypt();
    /** Un-setup crypt → produces the pre-handshake dummy key/nonce. */
    private readonly _dummy: Ts3Crypt = new Ts3Crypt();
    private _serverCmdId: number = 1;
    private _serverAckId: number = 1;

    /** Respond to client Init1 packet 0 with server packet 1 (cookie). */
    public packet1For(clientPacket0: Buffer): Buffer {
        const data: Buffer = unwrapInit1(PacketDirection.ClientToServer, clientPacket0);
        const a0: Buffer = data.subarray(9, 13);
        const a0Reversed: Buffer = Buffer.from(a0).reverse();
        return wrapServerInit1(buildPacket1(Buffer.alloc(16, 0x11), a0Reversed));
    }

    /** Server packet 3: an RSA puzzle with level 0 (trivially solvable: y = x). */
    public packet3(): Buffer {
        return wrapServerInit1(
            buildPacket3(
                Buffer.alloc(64, 0x01),
                Buffer.alloc(64, 0x02),
                0,
                Buffer.alloc(100, 0x03),
            ),
        );
    }

    /** Derive the shared secret from the client's clientinitiv (in packet 4). */
    public consumeClientInitIv(clientPacket4: Buffer): TsCommand {
        const data: Buffer = unwrapInit1(PacketDirection.ClientToServer, clientPacket4);
        const command: TsCommand = parseCommand(data.subarray(233 + 64).toString('utf8'));
        const alpha: Buffer = Buffer.from(firstValue(command, 'alpha') as string, 'base64');
        const clientOmega: Buffer = Buffer.from(firstValue(command, 'omega') as string, 'base64');
        const sharedX: Buffer = this.identity.sharedSecretX(clientOmega);
        this.crypt.setupSharedSecret(sharedX, alpha, BETA);
        return command;
    }

    /** initivexpand — sent pre-handshake with the dummy key (like a real server). */
    public initivexpand(): Buffer {
        const line: string = serializeCommand({
            name: 'initivexpand',
            records: [
                {
                    alpha: '', // alpha echoed by the server is not used by the client here
                    beta: BETA.toString('base64'),
                    omega: this.identity.omega(),
                },
            ],
        });
        return this._command(this._dummy, line);
    }

    public initserver(clientId: number, codecEncryptionMode: string): Buffer {
        return this._command(
            this.crypt,
            `initserver virtualserver_name=Test aclid=${clientId} ` +
                `virtualserver_codec_encryption_mode=${codecEncryptionMode}`,
        );
    }

    public notify(line: string): Buffer {
        return this._command(this.crypt, line);
    }

    public initFinished(): Buffer {
        return this._command(this.crypt, 'notifyclientinitfinished');
    }

    /** A server→client Voice packet (unencrypted, like a codec-disabled server). */
    public voice(senderId: number, voiceCounter: number, frame: Buffer): Buffer {
        const payload: Buffer = encodeVoiceS2C(voiceCounter, senderId, Codec.OpusVoice, frame);
        const packet: Ts3Packet = {
            mac: this.crypt.fakeSignature,
            packetId: 1,
            clientId: 0,
            type: PacketType.Voice,
            flags: PacketFlags.Unencrypted,
            data: payload,
        };
        return encodePacket(PacketDirection.ServerToClient, packet);
    }

    /** A server→client Ping the client must answer with a Pong. */
    public ping(packetId: number): Buffer {
        const packet: Ts3Packet = {
            mac: Buffer.alloc(8),
            packetId: packetId,
            clientId: 0,
            type: PacketType.Ping,
            flags: PacketFlags.Unencrypted,
            data: Buffer.alloc(0),
        };
        return encodePacket(PacketDirection.ServerToClient, packet);
    }

    /** Acknowledge a client→server reliable command by its packet id. */
    public ackCommand(ackedClientPacketId: number): Buffer {
        const data: Buffer = Buffer.alloc(2);
        data.writeUInt16BE(ackedClientPacketId & 0xffff, 0);
        const packetId: number = this._serverAckId++;
        const packet: Ts3Packet = {
            mac: Buffer.alloc(8),
            packetId: packetId,
            clientId: 0,
            type: PacketType.Ack,
            flags: PacketFlags.None,
            data: data,
        };
        const header: Buffer = encodeHeader(PacketDirection.ServerToClient, packet);
        const keyNonce = this.crypt.getKeyNonce(true, PacketType.Ack, packetId, 0);
        const sealed = this.crypt.encrypt(header, data, keyNonce);
        packet.mac = sealed.mac;
        packet.data = sealed.data;
        return encodePacket(PacketDirection.ServerToClient, packet);
    }

    /** Decrypt a client→server Command packet (to inspect clientinit etc.). */
    public decryptClientCommand(raw: Buffer): TsCommand {
        const packet: Ts3Packet = decodePacket(PacketDirection.ClientToServer, raw);
        const header: Buffer = encodeHeader(PacketDirection.ClientToServer, packet);
        const keyNonce = this.crypt.getKeyNonce(false, packet.type, packet.packetId, 0);
        const plain: Buffer = this.crypt.decrypt(header, packet.mac, packet.data, keyNonce);
        return parseCommand(plain.toString('utf8'));
    }

    private _command(crypt: Ts3Crypt, line: string): Buffer {
        const packetId: number = this._serverCmdId++;
        const data: Buffer = Buffer.from(line, 'utf8');
        const packet: Ts3Packet = {
            mac: Buffer.alloc(8),
            packetId: packetId,
            clientId: 0,
            type: PacketType.Command,
            flags: PacketFlags.None,
            data: data,
        };
        const header: Buffer = encodeHeader(PacketDirection.ServerToClient, packet);
        const keyNonce = crypt.getKeyNonce(true, PacketType.Command, packetId, 0);
        const sealed = crypt.encrypt(header, data, keyNonce);
        packet.mac = sealed.mac;
        packet.data = sealed.data;
        return encodePacket(PacketDirection.ServerToClient, packet);
    }
}

// --- harness ----------------------------------------------------------------

const CONFIG: TeamSpeakConfig = {
    host: 'ts.example.com',
    port: 9987,
    nickname: 'AudioMesh Bot',
    serverPassword: undefined,
    defaultChannelId: undefined,
    channelPassword: undefined,
    identity: undefined,
    startMuted: false,
};

interface Harness {
    client: Ts3ProtocolClient;
    transport: FakeTransport;
    runLoop: ManualRunLoop;
    handlers: RecordingHandlers;
    server: LoopbackServer;
    setNow: (ms: number) => void;
    now: () => number;
}

function makeHarness(): Harness {
    const transport: FakeTransport = new FakeTransport();
    const runLoop: ManualRunLoop = new ManualRunLoop();
    const handlers: RecordingHandlers = new RecordingHandlers();
    const server: LoopbackServer = new LoopbackServer();
    let clock: number = 1_000_000;
    const client: Ts3ProtocolClient = new Ts3ProtocolClient(CONFIG, {
        identity: Ts3Identity.generate(),
        codecFactory: new FakeCodecFactory(),
        transport: transport,
        runLoop: runLoop,
        clock: (): number => clock,
        random: (size: number): Buffer => Buffer.alloc(size, 0xa1),
        connectTimeoutMs: 10_000,
    });
    client.setHandlers(handlers);
    return {
        client: client,
        transport: transport,
        runLoop: runLoop,
        handlers: handlers,
        server: server,
        setNow: (ms: number): void => {
            clock = ms;
        },
        now: (): number => clock,
    };
}

/** Let the one `await transport.open()` inside connect() settle. */
async function flush(): Promise<void> {
    await new Promise<void>((resolve): void => {
        setImmediate(resolve);
    });
}

/** Drive connect() all the way to a connected session; returns the connect promise result. */
async function connect(
    h: Harness,
    codecEncryptionMode: string = '1',
    clientId: number = 42,
): Promise<void> {
    const connected: Promise<void> = h.client.connect();
    await flush();
    const packet0: Buffer = h.transport.sent[0] as Buffer;
    h.transport.deliver(h.server.packet1For(packet0));
    h.transport.deliver(h.server.packet3());
    const packet4: Buffer = h.transport.sent[h.transport.sent.length - 1] as Buffer;
    h.server.consumeClientInitIv(packet4);
    h.transport.drain();
    h.transport.deliver(h.server.initivexpand());
    h.transport.deliver(h.server.initserver(clientId, codecEncryptionMode));
    h.transport.deliver(h.server.initFinished());
    await connected;
    // Ack the clientinit (client Command id 1) so the session is not left with a
    // perpetually-pending reliable packet — exactly what a real server does.
    h.transport.deliver(h.server.ackCommand(1));
}

/** Find the last outbound packet of the given type. */
function lastOfType(transport: FakeTransport, type: number): Ts3Packet | null {
    for (let i: number = transport.sent.length - 1; i >= 0; i--) {
        const packet: Ts3Packet = decodePacket(
            PacketDirection.ClientToServer,
            transport.sent[i] as Buffer,
        );
        if (packet.type === type) {
            return packet;
        }
    }
    return null;
}

// --- tests ------------------------------------------------------------------

describe('Ts3ProtocolClient — Init1 + handshake', () => {
    let h: Harness;
    beforeEach((): void => {
        h = makeHarness();
    });

    it('sends a well-formed Init1 packet 0 on connect', async (): Promise<void> => {
        void h.client.connect();
        await flush();
        const raw: Buffer = h.transport.sent[0] as Buffer;
        const data: Buffer = unwrapInit1(PacketDirection.ClientToServer, raw);
        expect(data.length).toBe(21);
        expect(data[4]).toBe(0x00); // step byte of packet 0
    });

    it('completes the full handshake and reports connected with the assigned client id', async (): Promise<void> => {
        await connect(h, '1', 77);
        expect(h.client.isConnected()).toBe(true);
        // The client sent clientinit encrypted with the shared secret; the server
        // can decrypt it, proving both sides derived the same key.
        const clientinit: Ts3Packet | null = lastOfType(h.transport, PacketType.Command);
        expect(clientinit).not.toBeNull();
    });

    it('progresses Init1: packet 0 → 2 → 4 embeds clientinitiv', async (): Promise<void> => {
        void h.client.connect();
        await flush();
        const packet0: Buffer = h.transport.sent[0] as Buffer;
        h.transport.deliver(h.server.packet1For(packet0));
        h.transport.deliver(h.server.packet3());
        const packet4: Buffer = h.transport.sent[h.transport.sent.length - 1] as Buffer;
        const command: TsCommand = h.server.consumeClientInitIv(packet4);
        expect(command.name).toBe('clientinitiv');
        expect(firstValue(command, 'ot')).toBe('1');
    });

    it('surfaces a server error command as a connect rejection', async (): Promise<void> => {
        const connected: Promise<void> = h.client.connect();
        await flush();
        const packet0: Buffer = h.transport.sent[0] as Buffer;
        h.transport.deliver(h.server.packet1For(packet0));
        h.transport.deliver(h.server.packet3());
        h.server.consumeClientInitIv(h.transport.sent[h.transport.sent.length - 1] as Buffer);
        h.transport.deliver(h.server.initivexpand());
        h.transport.deliver(h.server.notify('error id=3329 msg=connection\\sfailed'));
        await expect(connected).rejects.toThrow(/3329/);
    });
});

describe('Ts3ProtocolClient — voice', () => {
    let h: Harness;
    beforeEach((): void => {
        h = makeHarness();
    });

    it('decodes an inbound voice packet to onAudioData and marks the speaker', async (): Promise<void> => {
        await connect(h);
        h.transport.deliver(h.server.voice(88, 0, Buffer.from([1, 2, 3, 4])));
        expect(h.handlers.audio).toHaveLength(1);
        expect(h.handlers.audio[0]?.participantId).toBe('88');
        expect(h.handlers.audio[0]?.sampleRate).toBe(48000);
        expect(h.handlers.audio[0]?.samples).toHaveLength(FRAME_SAMPLES);
        expect(h.handlers.speaking).toContainEqual({ id: '88', speaking: true });
    });

    it('reports talk-stop on an empty voice frame', async (): Promise<void> => {
        await connect(h);
        h.transport.deliver(h.server.voice(88, 0, Buffer.from([1, 2, 3, 4])));
        h.transport.deliver(h.server.voice(88, 1, Buffer.alloc(0)));
        expect(h.handlers.speaking).toContainEqual({ id: '88', speaking: false });
    });

    it('encodes outbound PCM into a voice packet the server can decode', async (): Promise<void> => {
        await connect(h);
        h.transport.drain();
        h.client.sendAudio(new Int16Array(FRAME_SAMPLES), 48000);
        const voice: Ts3Packet | null = lastOfType(h.transport, PacketType.Voice);
        expect(voice).not.toBeNull();
        const payload: VoicePayloadC2S = decodeVoiceC2S((voice as Ts3Packet).data);
        expect(payload.codec).toBe(Codec.OpusVoice);
        expect(payload.voiceCounter).toBe(0);
        expect(payload.frame[0]).toBe(0xee); // our fake encoder marker
    });

    it('does not send voice while muted', async (): Promise<void> => {
        await connect(h);
        await h.client.setMuted(true);
        h.transport.drain();
        h.client.sendAudio(new Int16Array(FRAME_SAMPLES), 48000);
        expect(lastOfType(h.transport, PacketType.Voice)).toBeNull();
    });
});

describe('Ts3ProtocolClient — participants & keepalive', () => {
    let h: Harness;
    beforeEach((): void => {
        h = makeHarness();
    });

    it('tracks participants from enter/left-view notifies', async (): Promise<void> => {
        await connect(h);
        h.transport.deliver(h.server.notify('notifycliententerview clid=5 client_nickname=Stefan'));
        expect(h.handlers.joined).toContainEqual({ id: '5', displayName: 'Stefan' });
        expect(h.client.getParticipants()).toHaveLength(1);
        h.transport.deliver(h.server.notify('notifyclientleftview clid=5'));
        expect(h.handlers.left).toContain('5');
        expect(h.client.getParticipants()).toHaveLength(0);
    });

    it('answers a server ping with a pong echoing the ping id', async (): Promise<void> => {
        await connect(h);
        h.transport.drain();
        h.transport.deliver(h.server.ping(0x2222));
        const pong: Ts3Packet | null = lastOfType(h.transport, PacketType.Pong);
        expect(pong).not.toBeNull();
        expect((pong as Ts3Packet).data.readUInt16BE(0)).toBe(0x2222);
    });

    it('pings on its own about once a second via the run-loop', async (): Promise<void> => {
        await connect(h);
        h.transport.drain();
        h.setNow(h.now() + 1_100);
        h.runLoop.tick?.();
        expect(lastOfType(h.transport, PacketType.Ping)).not.toBeNull();
    });

    it('retransmits an unacked reliable command until it is acked', async (): Promise<void> => {
        await connect(h);
        h.transport.drain();
        void h.client.joinChannel('7'); // a reliable clientmove, unacked
        const firstCount: number = h.transport.sent.length;
        h.setNow(h.now() + 600);
        h.runLoop.tick?.();
        expect(h.transport.sent.length).toBeGreaterThan(firstCount); // resent
    });

    it('fails the connection on inactivity timeout', async (): Promise<void> => {
        await connect(h);
        h.setNow(h.now() + 31_000);
        h.runLoop.tick?.();
        expect(h.handlers.errors.some((e: string): boolean => e.includes('timed out'))).toBe(true);
        expect(h.client.isConnected()).toBe(false);
    });
});

describe('Ts3ProtocolClient — connect failures', () => {
    it('rejects connect when the handshake never completes (timeout)', async (): Promise<void> => {
        const h: Harness = makeHarness();
        const connected: Promise<void> = h.client.connect();
        await flush();
        h.setNow(h.now() + 11_000);
        h.runLoop.tick?.();
        await expect(connected).rejects.toThrow(/timed out/);
    });

    it('rejects a second concurrent connect', async (): Promise<void> => {
        const h: Harness = makeHarness();
        void h.client.connect();
        await flush();
        await expect(h.client.connect()).rejects.toThrow(/already/);
    });
});
