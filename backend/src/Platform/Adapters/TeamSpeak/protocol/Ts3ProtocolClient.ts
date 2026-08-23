import type {
    ITeamSpeakClient,
    TeamSpeakClientHandlers,
    TeamSpeakParticipant,
} from '../ITeamSpeakClient.js';
import type { TeamSpeakConfig } from '../TeamSpeakConfig.js';

/** TS3's native voice sample rate (Opus Voice / Music are 48 kHz mono). */
const TS3_VOICE_RATE: number = 48000;

/**
 * Native TypeScript implementation of the TeamSpeak 3 client↔server **UDP voice
 * protocol** — the concrete {@link ITeamSpeakClient} the {@link TeamSpeakAdapter}
 * drives. TS3 has no official Node voice client and the community libraries
 * (`ts3-nodejs-library` et al.) only speak the text ServerQuery admin interface,
 * never voice — so, exactly as we did for Jitsi, we implement the wire protocol
 * ourselves rather than depend on a dead/unavailable lib.
 *
 * ## Layered protocol stack (build order)
 *
 * This client is the top of a stack that will live under this `protocol/` folder.
 * Each layer is independently testable; the dependency order is bottom-up:
 *
 * 1. **UDP transport** — `dgram` socket to `host:port` (9987), send/recv datagrams.
 * 2. **Packet codec** — header (MAC · packet id · client id · type+flags) encode/
 *    decode; the packet-type enum (Voice, VoiceWhisper, Command, CommandLow, Ping,
 *    Pong, Ack, AckLow, Init1); (de)compression (QuickLZ) and fragmentation.
 * 3. **Crypto** — the low-level Init1 puzzle handshake, then the ECDH identity
 *    handshake (alpha/beta/omega → shared IV) and per-packet AES-EAX encryption +
 *    8-byte MAC. **Highest-risk layer** — must be reverse-engineering-accurate.
 * 4. **Reliability / ack** — per-type packet-id counters, ack of Command/CommandLow,
 *    retransmit, generation/overflow handling.
 * 5. **Command layer** — TS3 `cmd key=value|...` encode/parse with escaping;
 *    clientinit(iv)/clientinitfinished, channel list & subscribe, the
 *    notify* events (enter/left view, talk status, text message).
 * 6. **Voice / Opus** — voice packet payload (voice id · codec byte · frame),
 *    Opus Voice/Music encode+decode at 48 kHz, talk-start/stop signalling.
 * 7. **This client** — wires the layers onto the {@link ITeamSpeakClient} seam and
 *    raises {@link TeamSpeakClientHandlers}.
 *
 * The exact byte layouts, crypto derivations, enum values and Opus parameters are
 * pinned from authoritative sources (Splamy/TS3AudioBot `TSLib`, ReSpeak protocol
 * docs) in `./PROTOCOL.md` — the implementation spec this stack is built against.
 * Until the layers land, {@link connect} rejects with a clear not-yet-implemented
 * error so a configured TS3 platform fails cleanly at connect rather than silently
 * doing nothing.
 */
export class Ts3ProtocolClient implements ITeamSpeakClient {
    private readonly _config: TeamSpeakConfig;
    private _handlers: TeamSpeakClientHandlers | null = null;
    private _connected: boolean = false;

    public constructor(config: TeamSpeakConfig) {
        this._config = config;
    }

    public setHandlers(handlers: TeamSpeakClientHandlers): void {
        this._handlers = handlers;
    }

    public async connect(): Promise<void> {
        // TODO(ts3): implement the UDP transport → packet codec → crypto handshake
        // → login (clientinitiv). See the layered plan in this file's doc comment.
        void this._config;
        void this._handlers;
        throw new Error(
            'Ts3ProtocolClient: the native TS3 voice protocol stack is not implemented yet',
        );
    }

    public async disconnect(): Promise<void> {
        this._connected = false;
    }

    public isConnected(): boolean {
        return this._connected;
    }

    public async getChannels(): Promise<{ id: string; name: string }[]> {
        return [];
    }

    public async joinChannel(_channelId: string): Promise<void> {
        throw new Error('Ts3ProtocolClient: not implemented yet');
    }

    public getParticipants(): TeamSpeakParticipant[] {
        return [];
    }

    public sendAudio(_samples: Int16Array, _sampleRate: number): void {
        // TODO(ts3): resample to 48 kHz, Opus-encode, packetise as Voice packets.
    }

    public getSendSampleRate(): number {
        return TS3_VOICE_RATE;
    }

    public async setMuted(_muted: boolean): Promise<void> {
        // TODO(ts3): send a clientupdate with client_input_muted/client_output_muted.
    }
}
