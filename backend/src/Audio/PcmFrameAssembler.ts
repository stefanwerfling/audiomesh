import { INTERNAL_AUDIO_FORMAT, type IAudioFrame } from './AudioFormat.js';

/** Number of PCM samples in one frame of the given duration at the internal rate. */
export function samplesPerFrame(frameMs: number): number {
    return (INTERNAL_AUDIO_FORMAT.sampleRate * frameMs) / 1000;
}

/**
 * Buffers a stream of mono 16 kHz PCM samples and emits fixed-size
 * {@link IAudioFrame}s (internal format: s16le, mono, 16 kHz). Adapters push
 * decoded/resampled samples in whatever chunk size the platform delivers; the
 * assembler regularises them into the mesh's canonical frame size so downstream
 * DSP, routing and transcription see a steady cadence. Any tail shorter than a
 * full frame is retained until the next push (or {@link flush}).
 */
export class PcmFrameAssembler {
    private readonly _samplesPerFrame: number;
    private readonly _speakerId: string | undefined;
    private _pending: number[] = [];

    public constructor(frameMs: number = 20, speakerId?: string) {
        this._samplesPerFrame = samplesPerFrame(frameMs);
        this._speakerId = speakerId;
    }

    /** Append samples and return every whole frame that is now complete. */
    public push(samples: Int16Array, timestamp: number): IAudioFrame[] {
        for (const sample of samples) {
            this._pending.push(sample);
        }
        return this._drain(timestamp, false);
    }

    /**
     * Emit any buffered tail as a final (zero-padded) frame. Called when a track
     * ends so no trailing speech is lost.
     */
    public flush(timestamp: number): IAudioFrame[] {
        if (this._pending.length === 0) {
            return [];
        }
        while (this._pending.length < this._samplesPerFrame) {
            this._pending.push(0);
        }
        return this._drain(timestamp, true);
    }

    private _drain(timestamp: number, includePartial: boolean): IAudioFrame[] {
        const frames: IAudioFrame[] = [];
        while (this._pending.length >= this._samplesPerFrame) {
            const slice: number[] = this._pending.splice(0, this._samplesPerFrame);
            frames.push(this._toFrame(slice, timestamp));
        }
        if (includePartial && this._pending.length > 0) {
            const slice: number[] = this._pending.splice(0, this._pending.length);
            frames.push(this._toFrame(slice, timestamp));
        }
        return frames;
    }

    private _toFrame(samples: number[], timestamp: number): IAudioFrame {
        const buffer: Buffer = Buffer.alloc(samples.length * INTERNAL_AUDIO_FORMAT.bytesPerSample);
        for (let i: number = 0; i < samples.length; i++) {
            buffer.writeInt16LE(
                clampInt16(samples[i] as number),
                i * INTERNAL_AUDIO_FORMAT.bytesPerSample,
            );
        }
        return {
            data: buffer,
            timestamp: timestamp,
            sampleRate: INTERNAL_AUDIO_FORMAT.sampleRate,
            channels: INTERNAL_AUDIO_FORMAT.channels,
            speakerId: this._speakerId,
        };
    }
}

/** Clamp to the signed 16-bit range so interpolation overshoot never wraps. */
export function clampInt16(value: number): number {
    if (value > 32767) {
        return 32767;
    }
    if (value < -32768) {
        return -32768;
    }
    return value;
}
