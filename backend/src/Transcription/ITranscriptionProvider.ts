import type { IAudioSource } from '../Audio/IAudio.js';

export interface TranscriptResult {
    speakerId: string;
    text: string;
    language?: string;
    confidence?: number;
    final: boolean;
    timestamp: number;
}

export type TranscriptListener = (result: TranscriptResult) => void;

/**
 * Streaming speech-to-text. Fed a per-participant {@link IAudioSource}, it emits
 * partial results as speech is recognised and a final result when an utterance
 * ends. OpenAI (`OpenAITranscriptionProvider`) is the sole implementation; the
 * Core depends only on this so the STT backend can change without ripple.
 */
export interface ITranscriptionProvider {
    readonly name: string;

    /** Begin transcribing `source` for `speakerId`; results arrive via `onResult`. */
    start(speakerId: string, source: IAudioSource, onResult: TranscriptListener): Promise<void>;

    /** Stop transcribing a previously started speaker. */
    stop(speakerId: string): Promise<void>;
}
