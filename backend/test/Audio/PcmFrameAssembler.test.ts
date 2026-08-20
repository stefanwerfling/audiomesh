import { describe, expect, it } from 'vitest';
import { INTERNAL_AUDIO_FORMAT } from '../../src/Audio/AudioFormat.js';
import {
    PcmFrameAssembler,
    clampInt16,
    samplesPerFrame,
} from '../../src/Audio/PcmFrameAssembler.js';

describe('PcmFrameAssembler', () => {
    const PER_FRAME: number = samplesPerFrame(20); // 320 @ 16 kHz

    it('computes 320 samples for a 20 ms frame at 16 kHz', () => {
        expect(PER_FRAME).toBe(320);
    });

    it('emits whole frames only and buffers the remainder', () => {
        const a: PcmFrameAssembler = new PcmFrameAssembler(20, 'spk-1');
        const frames = a.push(new Int16Array(PER_FRAME + 100).fill(7), 1000);
        expect(frames).toHaveLength(1);
        const frame = frames[0]!;
        expect(frame.speakerId).toBe('spk-1');
        expect(frame.sampleRate).toBe(INTERNAL_AUDIO_FORMAT.sampleRate);
        expect(frame.channels).toBe(1);
        expect(frame.data.length).toBe(PER_FRAME * INTERNAL_AUDIO_FORMAT.bytesPerSample);
        expect(frame.data.readInt16LE(0)).toBe(7);
    });

    it('completes a frame once enough samples have accumulated across pushes', () => {
        const a: PcmFrameAssembler = new PcmFrameAssembler(20);
        expect(a.push(new Int16Array(200).fill(1), 1)).toHaveLength(0);
        const frames = a.push(new Int16Array(200).fill(1), 2);
        expect(frames).toHaveLength(1);
        expect(frames[0]!.data.length).toBe(PER_FRAME * 2);
    });

    it('flush zero-pads and emits the trailing partial frame', () => {
        const a: PcmFrameAssembler = new PcmFrameAssembler(20);
        a.push(new Int16Array(50).fill(9), 1);
        const flushed = a.flush(5);
        expect(flushed).toHaveLength(1);
        expect(flushed[0]!.data.length).toBe(PER_FRAME * INTERNAL_AUDIO_FORMAT.bytesPerSample);
        // First 50 samples are the data, the rest is silence.
        expect(flushed[0]!.data.readInt16LE(0)).toBe(9);
        expect(flushed[0]!.data.readInt16LE(60 * 2)).toBe(0);
    });

    it('flush on an empty buffer yields nothing', () => {
        expect(new PcmFrameAssembler(20).flush(0)).toHaveLength(0);
    });

    it('clamps out-of-range values to the int16 domain', () => {
        expect(clampInt16(40000)).toBe(32767);
        expect(clampInt16(-40000)).toBe(-32768);
        expect(clampInt16(123)).toBe(123);
    });
});
