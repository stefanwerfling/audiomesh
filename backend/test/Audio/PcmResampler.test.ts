import { describe, expect, it } from 'vitest';
import { PcmResampler } from '../../src/Audio/PcmResampler.js';

describe('PcmResampler', () => {
    it('passes samples through unchanged when rates match', () => {
        const r: PcmResampler = new PcmResampler(16000, 16000);
        const input: Int16Array = Int16Array.from([1, 2, 3, -4, 5]);
        const out: Int16Array = r.process(input);
        expect([...out]).toEqual([1, 2, 3, -4, 5]);
        // Must be a copy, not the same backing buffer.
        expect(out).not.toBe(input);
    });

    it('downsamples 48k -> 16k at roughly a third of the length', () => {
        const r: PcmResampler = new PcmResampler(48000, 16000);
        const input: Int16Array = new Int16Array(48000).fill(1000);
        const out: Int16Array = r.process(input);
        // 48000 in at ratio 3 -> ~16000 out (±1 for the fractional cursor).
        expect(out.length).toBeGreaterThanOrEqual(15999);
        expect(out.length).toBeLessThanOrEqual(16001);
    });

    it('preserves a constant DC level through resampling', () => {
        const r: PcmResampler = new PcmResampler(48000, 16000);
        const out: Int16Array = r.process(new Int16Array(9000).fill(-1234));
        for (const s of out) {
            expect(s).toBe(-1234);
        }
    });

    it('keeps continuity across chunk boundaries (no per-chunk restart)', () => {
        const streamed: PcmResampler = new PcmResampler(48000, 16000);
        const whole: PcmResampler = new PcmResampler(48000, 16000);

        const ramp: Int16Array = new Int16Array(6000);
        for (let i: number = 0; i < ramp.length; i++) {
            ramp[i] = i % 100;
        }
        const a: Int16Array = streamed.process(ramp.subarray(0, 3000));
        const b: Int16Array = streamed.process(ramp.subarray(3000));
        const merged: number[] = [...a, ...b];
        const oneShot: number[] = [...whole.process(ramp)];

        // Streaming in two halves yields the same sample count as one pass.
        expect(merged.length).toBe(oneShot.length);
    });

    it('rejects non-positive rates', () => {
        expect(() => new PcmResampler(0, 16000)).toThrow();
        expect(() => new PcmResampler(48000, -1)).toThrow();
    });
});
