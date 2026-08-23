import { Buffer } from 'node:buffer';
import { randomBytes } from 'node:crypto';
import type {
    ITeamSpeakClient,
    TeamSpeakClientHandlers,
    TeamSpeakParticipant,
} from '../ITeamSpeakClient.js';
import type { TeamSpeakConfig } from '../TeamSpeakConfig.js';
import { CommandDispatcher } from './command/CommandDispatcher.js';
import { firstValue, serializeCommand, type TsCommand } from './command/TsCommand.js';
import { Ts3Crypt } from './crypto/Ts3Crypt.js';
import { Ts3Identity } from './crypto/Ts3Identity.js';
import { CryptoHandshake, type HandshakeStep } from './handshake/CryptoHandshake.js';
import { encodeClientVersion, Init1Handshake, type Init1Outcome } from './init1/Init1.js';
import { hasFlag, PacketFlags, PacketType } from './packet/PacketType.js';
import {
    encodeHeader,
    encodePacket,
    decodePacket,
    PacketDirection,
    type Ts3Packet,
} from './packet/Ts3Packet.js';
import { AckQueue } from './reliability/AckQueue.js';
import { KeepAlive } from './reliability/KeepAlive.js';
import { fragmentCommand, FragmentReassembler, MAX_DATA_C2S } from './reliability/Fragmentation.js';
import { IncomingGenerationTracker, OutgoingPacketCounter } from './reliability/PacketCounter.js';
import { quickLzDecompress } from './reliability/QuickLz.js';
import { DiscordOpusCodecFactory } from './voice/DiscordOpusCodec.js';
import {
    OPUS_VOICE,
    type IOpusCodecFactory,
    type IOpusDecoder,
    type IOpusEncoder,
} from './voice/IOpusCodec.js';
import { VoiceCounter } from './voice/VoiceCounter.js';
import {
    Codec,
    decodeVoiceS2C,
    encodeVoiceC2S,
    type VoicePayloadS2C,
} from './voice/VoicePacket.js';
import { VoiceReorderBuffer, type VoiceEvent } from './voice/VoiceReorderBuffer.js';
import { Ts3UdpTransport } from './transport/Ts3UdpTransport.js';

/** TS3's native voice sample rate (Opus Voice / Music are 48 kHz). */
const TS3_VOICE_RATE: number = 48000;
/** How often the run-loop ticks (resends, pings, timeout checks). */
const RUN_LOOP_TICK_MS: number = 100;
/** Give up a connect attempt whose handshake stalls this long. */
const DEFAULT_CONNECT_TIMEOUT_MS: number = 10_000;
/** Hashcash security level a fresh identity is mined to (TS3 servers require ≥8). */
const DEFAULT_SECURITY_LEVEL: number = 8;
/** How many empty voice frames mark end-of-talk (`PROTOCOL.md` §6.4). */
const TALK_STOP_FRAMES: number = 3;

/**
 * A genuine TeamSpeak-signed client version tuple — the newest stable TeamSpeak 3
 * **Linux** client from ReSpeak/tsdeclarations `Versions.csv` (the same dataset
 * tsclientlib uses). The `client_version_sign` is an Ed25519 signature by TeamSpeak
 * over `client_version + client_platform`, so these three MUST stay a matched set;
 * overriding one without the others yields a signature the server rejects.
 */
const DEFAULT_CLIENT_VERSION: string = '3.5.5 [Build: 1594213121]';
const DEFAULT_CLIENT_VERSION_SIGN: string =
    'qcElldtu07fZwpqJibMXCuGjdzgk1W+bHOmtrMRQzUEo+qxkETaR/dUpUqrF3WUKQ0XC58E0wG584toQGk2jBA==';
const DEFAULT_CLIENT_PLATFORM: string = 'Linux';

/**
 * Pull the `[Build: N]` unix timestamp out of a version string — this is the value
 * the Init1 §3 version field encodes (`unixSeconds − epoch`), so it must match the
 * build we claim in `client_version` rather than the wall clock.
 */
function parseBuildTimestamp(version: string): number | null {
    const match: RegExpExecArray | null = /\[Build:\s*(\d+)\]/.exec(version);
    if (match === null) {
        return null;
    }
    const build: number = Number.parseInt(match[1] as string, 10);
    return Number.isFinite(build) ? build : null;
}

/**
 * The structural transport contract the client drives — satisfied by the concrete
 * {@link Ts3UdpTransport} and by a fake in tests, so the whole client is exercisable
 * without a real socket.
 */
export interface ITs3Transport {
    setHandlers(handlers: {
        onMessage(data: Buffer): void;
        onError(error: Error): void;
        onClose(): void;
    }): void;
    open(host: string, port: number): Promise<void>;
    send(data: Buffer): void;
    isOpen(): boolean;
    close(): Promise<void>;
}

/**
 * The run-loop scheduler seam. Production uses a `setInterval`; tests inject a manual
 * scheduler that captures the tick so they can drive time with a fake clock — the
 * same clock-injection discipline the reliability layers use.
 */
export interface Ts3RunLoop {
    start(tick: () => void): void;
    stop(): void;
}

class IntervalRunLoop implements Ts3RunLoop {
    private readonly _intervalMs: number;
    private _handle: ReturnType<typeof setInterval> | null = null;

    public constructor(intervalMs: number) {
        this._intervalMs = intervalMs;
    }

    public start(tick: () => void): void {
        this._handle = setInterval(tick, this._intervalMs);
        this._handle.unref?.();
    }

    public stop(): void {
        if (this._handle !== null) {
            clearInterval(this._handle);
            this._handle = null;
        }
    }
}

/** Injectable seams (all optional — production defaults wire the real ones). */
export interface Ts3ProtocolClientOptions {
    /** Bot identity; generated + mined to the security level when omitted. */
    identity?: Ts3Identity;
    /** Opus codec factory; defaults to the native `@discordjs/opus` binding. */
    codecFactory?: IOpusCodecFactory;
    /** UDP transport; defaults to a real {@link Ts3UdpTransport}. */
    transport?: ITs3Transport;
    /** Run-loop scheduler; defaults to a `setInterval` loop. */
    runLoop?: Ts3RunLoop;
    /** Monotonic-ish clock in ms; defaults to `Date.now`. */
    clock?: () => number;
    /** Randomness source; defaults to `node:crypto` `randomBytes`. */
    random?: (size: number) => Buffer;
    /** client_version tuple the server validates (with the matching signature). */
    clientVersion?: string;
    clientVersionSign?: string;
    clientPlatform?: string;
    connectTimeoutMs?: number;
    securityLevel?: number;
}

/** Per-sender receive state: reorder buffer + its own Opus decoder + speaking flag. */
interface SenderVoice {
    reorder: VoiceReorderBuffer;
    decoder: IOpusDecoder;
}

/**
 * Native TypeScript implementation of the TeamSpeak 3 client↔server **UDP voice
 * protocol** — the top of the `protocol/` stack and the concrete
 * {@link ITeamSpeakClient} the {@link TeamSpeakAdapter} drives. It wires the eight
 * lower layers together and owns the connection lifecycle:
 *
 * - **connect** — open the {@link ITs3Transport}, run the low-level {@link
 *   Init1Handshake} (RSA puzzle), then the {@link CryptoHandshake} (ECDH → shared
 *   secret in {@link Ts3Crypt}, `clientinit` → `initserver`), and resolve once the
 *   server sends `notifyclientinitfinished`.
 * - **receive** — decrypt/reassemble Command packets and dispatch notifies via
 *   {@link CommandDispatcher}; decode Voice packets through a per-sender
 *   {@link VoiceReorderBuffer} + Opus decoder into `onAudioData`; reply to server
 *   Pings; ack reliable commands.
 * - **send** — reliable commands (tracked in {@link AckQueue}, retransmitted by the
 *   run-loop), Acks, Pings, and outbound Opus voice.
 * - **run-loop** — a clock-driven tick ({@link Ts3RunLoop}) that retransmits due
 *   packets, pings (~1 s), and fails the connection on timeout.
 *
 * Only the **old protocol (<3.1)** path is wired (matching {@link Ts3Crypt} /
 * {@link CryptoHandshake}). Byte layouts that can only be confirmed against a live
 * server (Init1 §3, the exact key/ack timing of the two handshake commands, the
 * server's codec-encryption mode, compressed channel lists needing QuickLZ) are
 * marked with TODOs per `protocol/PROTOCOL.md` §10 — this is the layer where the
 * first live connect will surface them.
 */
export class Ts3ProtocolClient implements ITeamSpeakClient {
    private readonly _config: TeamSpeakConfig;
    private readonly _transport: ITs3Transport;
    private readonly _runLoop: Ts3RunLoop;
    private readonly _clock: () => number;
    private readonly _random: (size: number) => Buffer;
    private readonly _codecFactory: IOpusCodecFactory;
    private readonly _connectTimeoutMs: number;
    private readonly _securityLevel: number;
    private readonly _clientVersion: string;
    private readonly _clientVersionSign: string;
    private readonly _clientPlatform: string;
    private readonly _buildTimestamp: number;

    private _handlers: TeamSpeakClientHandlers | null = null;

    // Per-connection state (rebuilt on each connect()).
    private _identity: Ts3Identity | null = null;
    private _crypt: Ts3Crypt = new Ts3Crypt();
    private _handshake: CryptoHandshake | null = null;
    private _init1: Init1Handshake | null = null;
    private readonly _dispatcher: CommandDispatcher = new CommandDispatcher();
    private readonly _reassembler: FragmentReassembler = new FragmentReassembler();
    private readonly _ackQueue: AckQueue = new AckQueue();
    private readonly _keepAlive: KeepAlive = new KeepAlive();
    private readonly _outgoing: Map<number, OutgoingPacketCounter> = new Map();
    private readonly _incoming: Map<number, IncomingGenerationTracker> = new Map();
    private readonly _voiceCounter: VoiceCounter = new VoiceCounter();
    private readonly _senders: Map<string, SenderVoice> = new Map();
    private readonly _speaking: Set<string> = new Set();
    private readonly _participants: Map<string, TeamSpeakParticipant> = new Map();
    private _encoder: IOpusEncoder | null = null;
    private _sendQueue: number[] = [];

    private _clientId: number = 0;
    private _connected: boolean = false;
    private _connecting: boolean = false;
    private _voiceEncrypted: boolean = false;
    private _muted: boolean;
    private _connectStartedAt: number = 0;
    private _connectResolve: (() => void) | null = null;
    private _connectReject: ((error: Error) => void) | null = null;

    public constructor(config: TeamSpeakConfig, options: Ts3ProtocolClientOptions = {}) {
        this._config = config;
        this._muted = config.startMuted;
        this._transport = options.transport ?? new Ts3UdpTransport();
        this._runLoop = options.runLoop ?? new IntervalRunLoop(RUN_LOOP_TICK_MS);
        this._clock = options.clock ?? ((): number => Date.now());
        this._random = options.random ?? randomBytes;
        this._codecFactory = options.codecFactory ?? new DiscordOpusCodecFactory();
        this._connectTimeoutMs = options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;
        this._securityLevel = options.securityLevel ?? DEFAULT_SECURITY_LEVEL;
        // A real TeamSpeak-signed version tuple (see the DEFAULT_CLIENT_VERSION docs).
        // Overriding one field requires overriding all three with a matching signed set.
        this._clientVersion = options.clientVersion ?? DEFAULT_CLIENT_VERSION;
        this._clientVersionSign = options.clientVersionSign ?? DEFAULT_CLIENT_VERSION_SIGN;
        this._clientPlatform = options.clientPlatform ?? DEFAULT_CLIENT_PLATFORM;
        this._buildTimestamp =
            parseBuildTimestamp(this._clientVersion) ?? Math.floor(this._clock() / 1000);
        this._registerNotifyListeners();
    }

    public setHandlers(handlers: TeamSpeakClientHandlers): void {
        this._handlers = handlers;
    }

    public async connect(): Promise<void> {
        if (this._connected || this._connecting) {
            throw new Error('Ts3ProtocolClient: already connected/connecting');
        }
        this._resetConnectionState();
        this._identity = this._resolveIdentity();
        this._handshake = new CryptoHandshake(
            this._identity,
            this._crypt,
            {
                nickname: this._config.nickname,
                clientVersion: this._clientVersion,
                clientVersionSign: this._clientVersionSign,
                clientPlatform: this._clientPlatform,
                serverAddress: `${this._config.host}:${this._config.port}`,
                serverPassword: this._config.serverPassword,
                defaultChannel: this._config.defaultChannelId,
                defaultChannelPassword: this._config.channelPassword,
            },
            this._random,
        );
        this._encoder = this._codecFactory.createEncoder(OPUS_VOICE);

        this._transport.setHandlers({
            onMessage: (data: Buffer): void => this._onDatagram(data),
            onError: (error: Error): void => this._fail(error.message),
            onClose: (): void => this._onTransportClosed(),
        });

        await this._transport.open(this._config.host, this._config.port);

        const clientInitIv: Buffer = this._handshake.buildClientInitIv();
        // The Init1 version field encodes the claimed build's timestamp, not now().
        const version: Buffer = encodeClientVersion(this._buildTimestamp);
        this._init1 = new Init1Handshake(version, clientInitIv, this._random);

        this._connecting = true;
        this._connectStartedAt = this._clock();
        this._runLoop.start((): void => this._tick(this._clock()));

        const promise: Promise<void> = new Promise<void>((resolve, reject): void => {
            this._connectResolve = resolve;
            this._connectReject = reject;
        });
        this._transport.send(this._init1.start(Math.floor(this._clock() / 1000)));
        return promise;
    }

    public async disconnect(): Promise<void> {
        this._runLoop.stop();
        this._connected = false;
        this._connecting = false;
        this._encoder?.close();
        this._encoder = null;
        for (const sender of this._senders.values()) {
            sender.decoder.close();
        }
        this._senders.clear();
        this._speaking.clear();
        if (this._transport.isOpen()) {
            await this._transport.close();
        }
    }

    public isConnected(): boolean {
        return this._connected;
    }

    public async getChannels(): Promise<{ id: string; name: string }[]> {
        // TODO(ts3): the channel directory arrives as a (usually QuickLZ-compressed)
        // `channellist` notify; until QuickLZ decompression lands we cannot enumerate
        // it (PROTOCOL.md §2.5). Callers get an empty list rather than a guess.
        return [];
    }

    public async joinChannel(channelId: string): Promise<void> {
        const record: Record<string, string> = {
            clid: String(this._clientId),
            cid: channelId,
        };
        if (this._config.channelPassword !== undefined) {
            record['cpw'] = this._config.channelPassword;
        }
        this._sendReliableCommand({ name: 'clientmove', records: [record] });
    }

    public getParticipants(): TeamSpeakParticipant[] {
        return [...this._participants.values()];
    }

    public sendAudio(samples: Int16Array, sampleRate: number): void {
        if (this._muted || !this._connected || this._encoder === null) {
            return;
        }
        if (sampleRate !== TS3_VOICE_RATE) {
            // The adapter's ResamplingSendSink delivers 48 kHz; anything else would
            // need resampling we do not do here. Drop rather than emit wrong-rate audio.
            return;
        }
        for (let i: number = 0; i < samples.length; i++) {
            this._sendQueue.push(samples[i] as number);
        }
        const frameSamples: number = OPUS_VOICE.frameSize * OPUS_VOICE.channels;
        while (this._sendQueue.length >= frameSamples) {
            const frame: Int16Array = Int16Array.from(this._sendQueue.splice(0, frameSamples));
            const opus: Buffer = this._encoder.encode(frame);
            this._sendVoiceFrame(opus);
        }
    }

    public getSendSampleRate(): number {
        return TS3_VOICE_RATE;
    }

    public async setMuted(muted: boolean): Promise<void> {
        this._muted = muted;
        if (muted) {
            this._sendTalkStop();
        }
        if (this._connected) {
            this._sendReliableCommand({
                name: 'clientupdate',
                records: [{ client_input_muted: muted ? '1' : '0' }],
            });
        }
    }

    // --- connection lifecycle -------------------------------------------------

    private _resetConnectionState(): void {
        this._crypt = new Ts3Crypt();
        this._ackQueue.clear();
        this._keepAlive.reset();
        this._outgoing.clear();
        this._incoming.clear();
        this._voiceCounter.reset();
        this._senders.clear();
        this._speaking.clear();
        this._participants.clear();
        this._sendQueue = [];
        this._clientId = 0;
        this._connected = false;
        this._voiceEncrypted = false;
    }

    private _resolveIdentity(): Ts3Identity {
        if (this._config.identity !== undefined) {
            return Ts3Identity.fromExport(this._config.identity);
        }
        const identity: Ts3Identity = Ts3Identity.generate();
        identity.improveSecurityLevel(this._securityLevel);
        return identity;
    }

    private _finishHandshake(): void {
        this._clientId = this._handshake?.clientId ?? 0;
        this._keepAlive.start(this._clock());
        this._connected = true;
        this._connecting = false;
        const resolve: (() => void) | null = this._connectResolve;
        this._connectResolve = null;
        this._connectReject = null;
        resolve?.();
    }

    private _fail(message: string): void {
        const reject: ((error: Error) => void) | null = this._connectReject;
        this._connectResolve = null;
        this._connectReject = null;
        this._connecting = false;
        this._runLoop.stop();
        if (reject !== null) {
            reject(new Error(`Ts3ProtocolClient: ${message}`));
            return;
        }
        if (this._connected) {
            this._connected = false;
            this._handlers?.onError(message);
        }
    }

    private _onTransportClosed(): void {
        if (this._connecting || this._connected) {
            this._fail('transport closed');
        }
    }

    private _tick(now: number): void {
        if (this._connecting && now - this._connectStartedAt >= this._connectTimeoutMs) {
            this._fail('handshake timed out');
            return;
        }
        if (this._keepAlive.shouldPing(now)) {
            this._sendPing();
            this._keepAlive.markPinged(now);
        }
        for (const item of this._ackQueue.dueForResend(now)) {
            this._transport.send(item.wire);
        }
        if (this._ackQueue.timedOut(now).length > 0) {
            this._fail('reliable command not acknowledged (timeout)');
            return;
        }
        if (this._keepAlive.isTimedOut(now)) {
            this._fail('connection timed out (no packets)');
        }
    }

    // --- inbound --------------------------------------------------------------

    private _onDatagram(raw: Buffer): void {
        let packet: Ts3Packet;
        try {
            packet = decodePacket(PacketDirection.ServerToClient, raw);
        } catch {
            return; // too short / malformed — ignore
        }
        this._keepAlive.onPacketReceived(this._clock());

        switch (packet.type) {
            case PacketType.Init1:
                this._handleInit1(raw);
                return;
            case PacketType.Command:
            case PacketType.CommandLow:
                this._handleCommandPacket(packet);
                return;
            case PacketType.Ack:
            case PacketType.AckLow:
                this._handleAck(packet);
                return;
            case PacketType.Ping:
                this._sendPong(packet.packetId);
                return;
            case PacketType.Pong:
                return; // keepalive already noted the arrival
            case PacketType.Voice:
            case PacketType.VoiceWhisper:
                this._handleVoicePacket(packet);
                return;
            default:
                return;
        }
    }

    private _handleInit1(raw: Buffer): void {
        if (this._init1 === null) {
            return;
        }
        const outcome: Init1Outcome = this._init1.onServerPacket(raw);
        switch (outcome.kind) {
            case 'send':
            case 'complete':
                this._transport.send(outcome.packet);
                return;
            case 'restart':
                this._transport.send(this._init1.start(Math.floor(this._clock() / 1000)));
                return;
            case 'error':
                this._fail(outcome.message);
                return;
            default:
                return;
        }
    }

    private _handleCommandPacket(packet: Ts3Packet): void {
        let plain: Buffer;
        try {
            plain = this._decryptIncoming(packet);
        } catch {
            return; // bad MAC — drop without acking a packet we could not read
        }
        // Acknowledge each successfully-received reliable packet by its id.
        this._sendAck(
            packet.packetId,
            packet.type === PacketType.CommandLow ? PacketType.AckLow : PacketType.Ack,
        );

        const reassembled = this._reassembler.push(packet.flags, plain);
        if (reassembled === null) {
            return; // more fragments to come
        }
        let payload: Buffer = reassembled.payload;
        if (reassembled.compressed) {
            try {
                payload = quickLzDecompress(payload);
            } catch {
                return; // QuickLZ not implemented yet — drop the compressed notify
            }
        }
        this._handleCommandLine(payload.toString('utf8'));
    }

    private _handleCommandLine(line: string): void {
        const command: TsCommand = this._dispatcher.dispatch(line);
        if (this._handshake !== null && !this._handshake.complete) {
            const step: HandshakeStep = this._handshake.onCommand(command);
            switch (step.kind) {
                case 'send':
                    this._sendReliableCommand(step.command);
                    return;
                case 'complete':
                    this._finishHandshake();
                    return;
                case 'error':
                    this._fail(step.message);
                    return;
                default:
                    return;
            }
        }
    }

    private _handleAck(packet: Ts3Packet): void {
        let plain: Buffer;
        try {
            plain = this._decryptIncoming(packet);
        } catch {
            return;
        }
        if (plain.length >= 2) {
            this._ackQueue.ack(plain.readUInt16BE(0));
        }
    }

    private _handleVoicePacket(packet: Ts3Packet): void {
        let data: Buffer = packet.data;
        if (!hasFlag(packet.flags, PacketFlags.Unencrypted)) {
            try {
                data = this._decryptIncoming(packet);
            } catch {
                return;
            }
        }
        let payload: VoicePayloadS2C;
        try {
            payload = decodeVoiceS2C(data);
        } catch {
            return;
        }
        if (payload.codec !== Codec.OpusVoice && payload.codec !== Codec.OpusMusic) {
            return; // Speex/CELT are not implemented — ignore
        }
        const senderId: string = String(payload.senderClientId);
        const sender: SenderVoice = this._senderVoice(senderId);
        const events: VoiceEvent[] = sender.reorder.push(payload.voiceCounter, payload.frame);
        for (const event of events) {
            if (event.type === 'frame') {
                this._markSpeaking(senderId, true);
                const pcm: Int16Array = sender.decoder.decode(event.frame);
                this._handlers?.onAudioData({
                    participantId: senderId,
                    samples: pcm,
                    sampleRate: TS3_VOICE_RATE,
                });
            } else {
                this._markSpeaking(senderId, false);
            }
        }
    }

    private _markSpeaking(senderId: string, speaking: boolean): void {
        if (speaking) {
            if (!this._speaking.has(senderId)) {
                this._speaking.add(senderId);
                this._handlers?.onSpeakingChanged(senderId, true);
            }
            return;
        }
        if (this._speaking.delete(senderId)) {
            this._handlers?.onSpeakingChanged(senderId, false);
        }
    }

    private _decryptIncoming(packet: Ts3Packet): Buffer {
        const generation: number = this._incomingGenFor(packet.type).generationFor(packet.packetId);
        const keyNonce = this._crypt.getKeyNonce(true, packet.type, packet.packetId, generation);
        const header: Buffer = encodeHeader(PacketDirection.ServerToClient, packet);
        return this._crypt.decrypt(header, packet.mac, packet.data, keyNonce);
    }

    // --- outbound -------------------------------------------------------------

    private _sendReliableCommand(command: TsCommand): void {
        const payload: Buffer = Buffer.from(serializeCommand(command), 'utf8');
        for (const fragment of fragmentCommand(payload, MAX_DATA_C2S)) {
            this._sendPacket(PacketType.Command, fragment.flags, fragment.data, true);
        }
    }

    private _sendAck(ackedPacketId: number, type: number): void {
        const data: Buffer = Buffer.alloc(2);
        data.writeUInt16BE(ackedPacketId & 0xffff, 0);
        this._sendPacket(type, PacketFlags.None, data, false);
    }

    private _sendPing(): void {
        this._sendPacket(PacketType.Ping, PacketFlags.Unencrypted, Buffer.alloc(0), false);
    }

    private _sendPong(pingPacketId: number): void {
        const data: Buffer = Buffer.alloc(2);
        data.writeUInt16BE(pingPacketId & 0xffff, 0);
        this._sendPacket(PacketType.Pong, PacketFlags.Unencrypted, data, false);
    }

    private _sendVoiceFrame(opusFrame: Buffer): void {
        const payload: Buffer = encodeVoiceC2S(
            this._voiceCounter.next(),
            Codec.OpusVoice,
            opusFrame,
        );
        const flags: number = this._voiceEncrypted ? PacketFlags.None : PacketFlags.Unencrypted;
        this._sendPacket(PacketType.Voice, flags, payload, false);
    }

    private _sendTalkStop(): void {
        if (!this._connected) {
            return;
        }
        for (let i: number = 0; i < TALK_STOP_FRAMES; i++) {
            this._sendVoiceFrame(Buffer.alloc(0));
        }
    }

    /**
     * Frame, (optionally) EAX-seal and send one packet, tracking it for retransmit
     * when `reliable`. Unencrypted packets (Ping/Pong/Voice with the UE flag) carry
     * the crypt's fake signature as MAC; everything else is EAX-encrypted with the
     * per-(type,id,generation) key.
     */
    private _sendPacket(type: number, flags: number, data: Buffer, reliable: boolean): void {
        const count = this._outgoingFor(type).next();
        const base: Ts3Packet = {
            mac: Buffer.alloc(8),
            packetId: count.packetId,
            clientId: this._clientId,
            type: type as PacketType,
            flags: flags,
            data: data,
        };
        const header: Buffer = encodeHeader(PacketDirection.ClientToServer, base);
        if (hasFlag(flags, PacketFlags.Unencrypted)) {
            base.mac = this._crypt.fakeSignature;
        } else {
            const keyNonce = this._crypt.getKeyNonce(
                false,
                type as PacketType,
                count.packetId,
                count.generationId,
            );
            const sealed = this._crypt.encrypt(header, data, keyNonce);
            base.mac = sealed.mac;
            base.data = sealed.data;
        }
        const wire: Buffer = encodePacket(PacketDirection.ClientToServer, base);
        this._transport.send(wire);
        if (reliable) {
            this._ackQueue.track(count.packetId, wire, this._clock());
        }
    }

    // --- helpers --------------------------------------------------------------

    private _registerNotifyListeners(): void {
        this._dispatcher.on('notifycliententerview', (command: TsCommand): void => {
            for (const record of command.records) {
                const clid: string | undefined = record['clid'];
                if (clid === undefined) {
                    continue;
                }
                const participant: TeamSpeakParticipant = {
                    id: clid,
                    displayName: record['client_nickname'] ?? clid,
                };
                this._participants.set(clid, participant);
                this._handlers?.onParticipantJoined(participant);
            }
        });
        this._dispatcher.on('notifyclientleftview', (command: TsCommand): void => {
            for (const record of command.records) {
                const clid: string | undefined = record['clid'];
                if (clid === undefined) {
                    continue;
                }
                this._participants.delete(clid);
                this._markSpeaking(clid, false);
                this._handlers?.onParticipantLeft(clid);
            }
        });
        this._dispatcher.on('initserver', (command: TsCommand): void => {
            const mode: string | undefined = firstValue(
                command,
                'virtualserver_codec_encryption_mode',
            );
            // 2 = Enabled → voice must be EAX-encrypted; 0/1 → send unencrypted.
            this._voiceEncrypted = mode === '2';
        });
    }

    private _senderVoice(senderId: string): SenderVoice {
        let sender: SenderVoice | undefined = this._senders.get(senderId);
        if (sender === undefined) {
            sender = {
                reorder: new VoiceReorderBuffer(),
                decoder: this._codecFactory.createDecoder(OPUS_VOICE),
            };
            this._senders.set(senderId, sender);
        }
        return sender;
    }

    private _outgoingFor(type: number): OutgoingPacketCounter {
        let counter: OutgoingPacketCounter | undefined = this._outgoing.get(type);
        if (counter === undefined) {
            counter = new OutgoingPacketCounter();
            this._outgoing.set(type, counter);
        }
        return counter;
    }

    private _incomingGenFor(type: number): IncomingGenerationTracker {
        let tracker: IncomingGenerationTracker | undefined = this._incoming.get(type);
        if (tracker === undefined) {
            tracker = new IncomingGenerationTracker();
            this._incoming.set(type, tracker);
        }
        return tracker;
    }
}
