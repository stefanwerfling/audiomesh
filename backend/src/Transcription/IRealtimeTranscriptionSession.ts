/**
 * The seam between {@link OpenAITranscriptionProvider} and the concrete streaming
 * STT backend (OpenAI's Realtime transcription WebSocket). The provider owns all
 * the mesh-facing orchestration — per-speaker lifecycle, resampling, mapping to
 * `TranscriptResult` — and talks only to this interface, so it is fully testable
 * with a fake session and no network (same pattern as the Jitsi client seam).
 *
 * One session transcribes exactly one speaker's audio stream.
 */

/** Callbacks the provider registers when opening a session. */
export interface RealtimeTranscriptionHandlers {
    /** Interim hypothesis for the current utterance (may be revised). */
    onPartial(text: string): void;
    /** Settled transcript for a completed utterance. */
    onFinal(text: string): void;
    /** Non-fatal or fatal backend error — surfaced as `ErrorOccurred`. */
    onError(message: string): void;
}

export interface IRealtimeTranscriptionSession {
    /** PCM sample rate (Hz) this backend expects via {@link sendAudio}. */
    readonly inputSampleRate: number;

    /** Open the stream and register handlers; resolves once ready for audio. */
    open(handlers: RealtimeTranscriptionHandlers): Promise<void>;

    /** Feed one chunk of mono s16le PCM at {@link inputSampleRate}. No-op if closed. */
    sendAudio(pcm16: Buffer): void;

    /** Close the stream and release the connection. */
    close(): Promise<void>;
}

/** Factory the provider uses to build a session per speaker (fake in tests). */
export type RealtimeTranscriptionSessionFactory = () => IRealtimeTranscriptionSession;
