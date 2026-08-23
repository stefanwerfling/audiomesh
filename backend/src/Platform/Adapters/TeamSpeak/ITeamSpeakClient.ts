/**
 * The seam between the {@link TeamSpeakAdapter} and the concrete TS3 runtime (our
 * own native implementation of the TeamSpeak 3 UDP voice protocol —
 * {@link Ts3ProtocolClient}). The adapter holds all the mesh-facing logic —
 * resampling, framing, per-participant sources, event emission — and talks only
 * to this interface. The real implementation carries the heavy protocol stack
 * (UDP transport, packet crypto, reliability/ack, command layer, Opus); tests
 * drive a fake, so the adapter is fully testable without a live TS3 server
 * (project rule: the Core must be testable without a real voice platform).
 *
 * Audio crosses this seam already decoded to raw Int16 PCM at TS3's native voice
 * rate (48 kHz mono). Encoding/decoding Opus and converting to the internal mesh
 * format is split so the client stays a transport+codec shim and the adapter owns
 * the mesh format conversion — the same division as {@link IJitsiClient}.
 */

/** A client as reported by the TS3 server (from the channel/notify command layer). */
export interface TeamSpeakParticipant {
    /** The server-assigned client id (clid), stable for the session. */
    id: string;
    displayName: string;
}

/** One chunk of a remote client's decoded voice, native rate, mono Int16. */
export interface TeamSpeakAudioData {
    participantId: string;
    samples: Int16Array;
    sampleRate: number;
}

/** Callbacks the adapter registers before {@link ITeamSpeakClient.connect}. */
export interface TeamSpeakClientHandlers {
    onParticipantJoined(participant: TeamSpeakParticipant): void;
    onParticipantLeft(participantId: string): void;
    onAudioData(data: TeamSpeakAudioData): void;
    /**
     * A client's talk status changed. Unlike Jitsi's single dominant speaker, TS3
     * reports talk start/stop per client, so multiple can be `speaking` at once —
     * the adapter maps each directly onto per-participant speaking state.
     */
    onSpeakingChanged(participantId: string, speaking: boolean): void;
    /** Fatal transport error — the adapter maps it to an `ErrorOccurred` event. */
    onError(message: string): void;
}

export interface ITeamSpeakClient {
    /** Register event handlers. Must be called before {@link connect}. */
    setHandlers(handlers: TeamSpeakClientHandlers): void;

    /** Establish the UDP connection + crypto handshake + login (no channel yet). */
    connect(): Promise<void>;
    disconnect(): Promise<void>;
    isConnected(): boolean;

    /** Enumerate the server's channel directory (TS3 exposes a real channel tree). */
    getChannels(): Promise<{ id: string; name: string }[]>;

    /** Switch the bot into a channel by id. */
    joinChannel(channelId: string): Promise<void>;

    /** Snapshot of clients currently visible in the joined channel. */
    getParticipants(): TeamSpeakParticipant[];

    /**
     * Push one chunk of outbound PCM into the bot's voice stream (talkback / agent
     * TTS). `samples` are mono Int16 at `sampleRate`; the client resamples to the
     * codec rate, Opus-encodes and packetises. A no-op when muted. The adapter is
     * responsible only for delivering mesh-rate PCM; the client owns the codec.
     */
    sendAudio(samples: Int16Array, sampleRate: number): void;

    /** Rate (Hz) the client wants outbound audio at — TS3's native voice rate. */
    getSendSampleRate(): number;

    /** Mute/unmute the bot's own outgoing voice (server sees the mute state). */
    setMuted(muted: boolean): Promise<void>;
}
