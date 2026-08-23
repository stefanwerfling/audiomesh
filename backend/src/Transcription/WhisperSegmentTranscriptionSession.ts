import { INTERNAL_AUDIO_FORMAT } from '../Audio/AudioFormat.js';
import { encodeWav } from '../Audio/WavEncoder.js';
import { ConfigStore } from '../Store/ConfigStore.js';
import type {
    IRealtimeTranscriptionSession,
    RealtimeTranscriptionHandlers,
} from './IRealtimeTranscriptionSession.js';

/** Transcribe one WAV segment to text. Injectable so the session is testable. */
export type SegmentTranscriber = (wav: Buffer) => Promise<string>;

const BYTES_PER_SAMPLE: number = INTERNAL_AUDIO_FORMAT.bytesPerSample;
const SAMPLE_RATE: number = INTERNAL_AUDIO_FORMAT.sampleRate;

/** Mean-amplitude threshold (int16 scale) below which a chunk counts as silence. */
const SILENCE_AMPLITUDE: number = 500;
/** A pause this long ends the current utterance. */
const PAUSE_MS: number = 700;
/** Utterances shorter than this (total speech) are dropped as noise. */
const MIN_SPEECH_MS: number = 300;
/** Force a cut at this length even without a pause (keeps requests bounded). */
const MAX_SEGMENT_MS: number = 20000;

function msToBytes(ms: number): number {
    return Math.floor((ms / 1000) * SAMPLE_RATE) * BYTES_PER_SAMPLE;
}

const PAUSE_BYTES: number = msToBytes(PAUSE_MS);
const MIN_SPEECH_BYTES: number = msToBytes(MIN_SPEECH_MS);
const MAX_SEGMENT_BYTES: number = msToBytes(MAX_SEGMENT_MS);

/** Mean absolute amplitude of a mono s16le PCM buffer (cheap VAD energy proxy). */
function meanAmplitude(pcm: Buffer): number {
    const samples: number = Math.floor(pcm.length / BYTES_PER_SAMPLE);
    if (samples === 0) {
        return 0;
    }
    let sum: number = 0;
    for (let i: number = 0; i < samples; i++) {
        sum += Math.abs(pcm.readInt16LE(i * BYTES_PER_SAMPLE));
    }
    return sum / samples;
}

/**
 * A batch/segmenting {@link IRealtimeTranscriptionSession} for OpenAI-compatible
 * gateways that expose `/v1/audio/transcriptions` (Whisper) but not the Realtime
 * WebSocket. Instead of streaming, it runs a lightweight energy VAD over the
 * incoming 16 kHz PCM: audio is buffered while a speaker talks, and when they
 * pause (~{@link PAUSE_MS} of quiet) the accumulated speech is cut into a WAV
 * segment and enqueued. A single worker drains the queue **serially, in arrival
 * order (FIFO)** — one request at a time per speaker — so a speaker's lines stay
 * in spoken order. Each segment carries the capture time of its first speech
 * frame, emitted via `onFinal(text, startedAt)` so a report can be ordered by
 * when things were *said*, not when transcription returned. Final-only (no
 * partials). One session transcribes exactly one speaker.
 *
 * `inputSampleRate` is the internal 16 kHz, so the provider feeds frames verbatim
 * with no resample. The HTTP call is injectable ({@link SegmentTranscriber}) so
 * the segmentation/queue logic is unit-tested without a network.
 */
export class WhisperSegmentTranscriptionSession implements IRealtimeTranscriptionSession {
    public readonly inputSampleRate: number = SAMPLE_RATE;

    private readonly _transcribe: SegmentTranscriber;
    private _handlers: RealtimeTranscriptionHandlers | null = null;
    private _closed: boolean = false;

    // Current (in-progress) utterance.
    private _chunks: Buffer[] = [];
    private _segmentBytes: number = 0;
    private _speechBytes: number = 0;
    private _trailingSilenceBytes: number = 0;
    private _startedAt: number | null = null;

    // Serial processing of cut segments.
    private readonly _queue: Array<{ wav: Buffer; startedAt: number }> = [];
    private _draining: Promise<void> | null = null;

    public constructor(transcribe: SegmentTranscriber = defaultTranscribe) {
        this._transcribe = transcribe;
    }

    public async open(handlers: RealtimeTranscriptionHandlers): Promise<void> {
        this._handlers = handlers;
    }

    public sendAudio(pcm16: Buffer, capturedAt?: number): void {
        if (this._closed || pcm16.length === 0) {
            return;
        }
        const isSpeech: boolean = meanAmplitude(pcm16) >= SILENCE_AMPLITUDE;

        if (isSpeech) {
            if (this._startedAt === null) {
                this._startedAt = capturedAt ?? Date.now();
            }
            this._chunks.push(pcm16);
            this._segmentBytes += pcm16.length;
            this._speechBytes += pcm16.length;
            this._trailingSilenceBytes = 0;
        } else if (this._startedAt !== null) {
            // Mid-utterance silence: keep it (natural gaps) but watch for a pause.
            this._chunks.push(pcm16);
            this._segmentBytes += pcm16.length;
            this._trailingSilenceBytes += pcm16.length;
            if (this._trailingSilenceBytes >= PAUSE_BYTES) {
                this._cut();
                return;
            }
        }
        // Leading silence (no utterance yet) is dropped so segments start on speech.

        if (this._segmentBytes >= MAX_SEGMENT_BYTES) {
            this._cut();
        }
    }

    public async close(): Promise<void> {
        this._closed = true;
        this._cut(); // flush a trailing utterance, if any
        if (this._draining !== null) {
            await this._draining;
        }
        this._handlers = null;
    }

    /** Close off the current utterance and enqueue it if it holds enough speech. */
    private _cut(): void {
        const startedAt: number | null = this._startedAt;
        const speechBytes: number = this._speechBytes;
        const chunks: Buffer[] = this._chunks;
        this._chunks = [];
        this._segmentBytes = 0;
        this._speechBytes = 0;
        this._trailingSilenceBytes = 0;
        this._startedAt = null;

        if (startedAt === null || speechBytes < MIN_SPEECH_BYTES) {
            return;
        }
        const pcm: Buffer = Buffer.concat(chunks);
        const wav: Buffer = encodeWav(pcm, {
            sampleRate: SAMPLE_RATE,
            channels: INTERNAL_AUDIO_FORMAT.channels,
            bitsPerSample: BYTES_PER_SAMPLE * 8,
        });
        this._queue.push({ wav: wav, startedAt: startedAt });
        this._kick();
    }

    /** Start the drain worker if it isn't already running. */
    private _kick(): void {
        if (this._draining === null) {
            this._draining = this._drain().finally((): void => {
                this._draining = null;
            });
        }
    }

    /** Drain the queue one segment at a time, in FIFO order. */
    private async _drain(): Promise<void> {
        for (;;) {
            const item: { wav: Buffer; startedAt: number } | undefined = this._queue.shift();
            if (item === undefined) {
                return;
            }
            try {
                const text: string = (await this._transcribe(item.wav)).trim();
                if (text.length > 0) {
                    this._handlers?.onFinal(text, item.startedAt);
                }
            } catch (error: unknown) {
                this._handlers?.onError(
                    `segment transcription failed: ${(error as Error).message}`,
                );
            }
        }
    }
}

/** Real transcriber: POST the WAV to `<base>/v1/audio/transcriptions` (Whisper). */
async function defaultTranscribe(wav: Buffer): Promise<string> {
    const store: ConfigStore = ConfigStore.getInstance();
    const apiKey: string = store.getOpenAiKey();
    if (apiKey.length === 0) {
        throw new Error('OpenAI API key not configured');
    }
    const model: string = store.getSettings().openai.transcriptionModel || 'whisper-1';

    const form: FormData = new FormData();
    form.append('model', model);
    form.append('file', new Blob([wav], { type: 'audio/wav' }), 'segment.wav');

    const response: Response = await fetch(`${store.getOpenAiBaseUrl()}/v1/audio/transcriptions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}` },
        body: form,
    });
    if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
    }
    const payload: unknown = await response.json();
    if (payload !== null && typeof payload === 'object') {
        const text: unknown = (payload as Record<string, unknown>)['text'];
        if (typeof text === 'string') {
            return text;
        }
    }
    return '';
}
