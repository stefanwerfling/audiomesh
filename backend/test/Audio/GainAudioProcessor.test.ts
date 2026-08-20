import { describe, expect, it } from 'vitest';
import { INTERNAL_AUDIO_FORMAT, type IAudioFrame } from '../../src/Audio/AudioFormat.js';
import { GainAudioProcessor } from '../../src/Audio/GainAudioProcessor.js';

function frameOf(samples: number[]): IAudioFrame {
    const buf: Buffer = Buffer.alloc(samples.length * INTERNAL_AUDIO_FORMAT.bytesPerSample);
    samples.forEach((s: number, i: number): void => {
        buf.writeInt16LE(s, i * INTERNAL_AUDIO_FORMAT.bytesPerSample);
    });
    return {
        data: buf,
        timestamp: 1,
        sampleRate: INTERNAL_AUDIO_FORMAT.sampleRate,
        channels: INTERNAL_AUDIO_FORMAT.channels,
    };
}

function samplesOf(frame: IAudioFrame): number[] {
    const out: number[] = [];
    for (let i: number = 0; i + 2 <= frame.data.length; i += 2) {
        out.push(frame.data.readInt16LE(i));
    }
    return out;
}

describe('GainAudioProcessor', () => {
    it('returns the same frame instance at gain 1 (pass-through)', () => {
        const p: GainAudioProcessor = new GainAudioProcessor('g', 1);
        const f: IAudioFrame = frameOf([1, 2, 3]);
        expect(p.process(f)).toBe(f);
    });

    it('scales samples by the gain factor', () => {
        const p: GainAudioProcessor = new GainAudioProcessor('g', 2);
        expect(samplesOf(p.process(frameOf([1000, -2000, 0]))!)).toEqual([2000, -4000, 0]);
    });

    it('clamps to the int16 range on overshoot', () => {
        const p: GainAudioProcessor = new GainAudioProcessor('g', 100);
        expect(samplesOf(p.process(frameOf([1000, -1000]))!)).toEqual([32767, -32768]);
    });

    it('falls back to unity gain for invalid factors', () => {
        expect(new GainAudioProcessor('g', -5).gain).toBe(1);
        expect(new GainAudioProcessor('g', Number.NaN).gain).toBe(1);
    });
});
