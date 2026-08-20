import { INTERNAL_AUDIO_FORMAT, type IAudioFrame } from './AudioFormat.js';
import type { IAudioProcessor } from './IAudio.js';
import { clampInt16 } from './PcmFrameAssembler.js';

/**
 * Scales frame amplitude by a fixed gain factor — a minimal but real
 * {@link IAudioProcessor} for routes (e.g. attenuate a loud source before mixing
 * it into another platform). Gain 1 is a pass-through (returns the frame
 * unchanged, no copy); other values produce a new buffer with each sample scaled
 * and clamped to the int16 range so loud peaks don't wrap.
 */
export class GainAudioProcessor implements IAudioProcessor {
    public readonly id: string;
    private readonly _gain: number;

    public constructor(id: string, gain: number) {
        this.id = id;
        this._gain = Number.isFinite(gain) && gain >= 0 ? gain : 1;
    }

    public get gain(): number {
        return this._gain;
    }

    public process(frame: IAudioFrame): IAudioFrame | null {
        if (this._gain === 1) {
            return frame;
        }
        const step: number = INTERNAL_AUDIO_FORMAT.bytesPerSample;
        const out: Buffer = Buffer.alloc(frame.data.length);
        for (let i: number = 0; i + step <= frame.data.length; i += step) {
            const scaled: number = Math.round(frame.data.readInt16LE(i) * this._gain);
            out.writeInt16LE(clampInt16(scaled), i);
        }
        return { ...frame, data: out };
    }
}
