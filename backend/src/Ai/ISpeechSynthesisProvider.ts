/**
 * Text-to-speech. The inverse of {@link ../Transcription/ITranscriptionProvider}:
 * it turns agent text into raw PCM the mesh can push back out through a platform's
 * send sink (the Jitsi talkback path). OpenAI is the only implementation for now,
 * but the agent (Phase 7) depends only on this seam so the TTS backend — cloud or
 * a local voice later — can change without ripple. The API key lives entirely
 * behind the implementation.
 */

/** One synthesised utterance as raw PCM plus the format needed to resample it. */
export interface SynthesizedSpeech {
    /** Mono s16le PCM samples. */
    pcm: Buffer;
    /** Native sample rate (Hz) of {@link pcm} — resample to the mesh's 16 kHz on use. */
    sampleRate: number;
    /** Channel count (always 1 for the mesh path). */
    channels: number;
}

export interface ISpeechSynthesisProvider {
    readonly name: string;

    /** Whether the provider is configured (key present). */
    isConfigured(): boolean;

    /** Synthesise `text` into PCM. Rejects if unconfigured or the backend errors. */
    synthesize(text: string): Promise<SynthesizedSpeech>;
}
