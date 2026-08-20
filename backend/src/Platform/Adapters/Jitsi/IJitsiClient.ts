/**
 * The seam between the {@link JitsiAdapter} and the concrete Jitsi runtime
 * (`lib-jitsi-meet` + `jsdom` + WebRTC). The adapter contains all the mesh-facing
 * logic — resampling, framing, per-participant sources, event emission — and
 * talks only to this interface. The real implementation ({@link LibJitsiClient})
 * carries the heavy browser-emulation deps; tests drive a fake, so the adapter is
 * fully testable without a live Jitsi server (project rule: the Core must be
 * testable without a real voice platform).
 *
 * Audio is delivered exactly as WebRTC hands it out — raw Int16 PCM at the track's
 * native sample rate. Converting to the internal mesh format is the adapter's job,
 * not the client's, so the client stays a thin transport shim.
 */

/** A participant as reported by the Jitsi conference. */
export interface JitsiParticipant {
    id: string;
    displayName: string;
}

/** One chunk of a remote participant's audio track, native rate, mono Int16. */
export interface JitsiAudioData {
    participantId: string;
    samples: Int16Array;
    sampleRate: number;
}

/** Callbacks the adapter registers before {@link IJitsiClient.connect}. */
export interface JitsiClientHandlers {
    onParticipantJoined(participant: JitsiParticipant): void;
    onParticipantLeft(participantId: string): void;
    onAudioData(data: JitsiAudioData): void;
    /**
     * The bridge's current dominant speaker changed. `participantId` is the new
     * loudest speaker, or null when nobody is speaking. Jitsi computes this
     * server-side, so it works even with local audio-level analysis disabled.
     */
    onDominantSpeakerChanged(participantId: string | null): void;
    /** Fatal transport error — the adapter maps it to an `ErrorOccurred` event. */
    onError(message: string): void;
}

export interface IJitsiClient {
    /** Register event handlers. Must be called before {@link connect}. */
    setHandlers(handlers: JitsiClientHandlers): void;

    /** Establish the XMPP/BOSH connection (no room yet). */
    connect(): Promise<void>;
    disconnect(): Promise<void>;
    isConnected(): boolean;

    /** Join a conference room by name; resolves once the MUC is joined. */
    joinRoom(roomName: string): Promise<void>;
    leaveRoom(): Promise<void>;

    /** Snapshot of currently-known remote participants. */
    getParticipants(): JitsiParticipant[];

    /**
     * Push one chunk of outbound PCM into the bot's local track (talkback / agent
     * TTS). `samples` are mono Int16 at `sampleRate`; the client feeds them to the
     * WebRTC audio source unchanged. A no-op when muted or before a local track
     * exists. The adapter is responsible for resampling to the send rate and
     * chunking to the transport's frame size.
     */
    sendAudio(samples: Int16Array, sampleRate: number): void;

    /** Rate (Hz) the client wants outbound audio at — its native track rate. */
    getSendSampleRate(): number;

    /** Mute/unmute the bot's own outgoing track (peers see the mute state). */
    setMuted(muted: boolean): Promise<void>;
}
