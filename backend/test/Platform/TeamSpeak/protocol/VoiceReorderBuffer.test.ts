import { Buffer } from 'node:buffer';
import { describe, expect, it } from 'vitest';
import {
    u16Diff,
    VoiceReorderBuffer,
    type VoiceEvent,
} from '../../../../src/Platform/Adapters/TeamSpeak/protocol/voice/VoiceReorderBuffer.js';

/** A distinct non-empty frame per counter, so we can assert ordering by content. */
function frame(n: number): Buffer {
    return Buffer.from([n & 0xff, 0xaa]);
}

/** Extract the emitted counters (frame events only) for terse assertions. */
function counters(events: VoiceEvent[]): number[] {
    return events
        .filter((e: VoiceEvent) => e.type === 'frame')
        .map((e) => (e as { voiceCounter: number }).voiceCounter);
}

describe('u16Diff', () => {
    it('is signed and wrap-aware', () => {
        expect(u16Diff(5, 3)).toBe(2);
        expect(u16Diff(3, 5)).toBe(-2);
        expect(u16Diff(0, 0xffff)).toBe(1); // wrap forward
        expect(u16Diff(0xffff, 0)).toBe(-1); // wrap backward
    });
});

describe('VoiceReorderBuffer', () => {
    it('passes in-order frames straight through', () => {
        const buf: VoiceReorderBuffer = new VoiceReorderBuffer();
        expect(counters(buf.push(10, frame(10)))).toEqual([10]);
        expect(counters(buf.push(11, frame(11)))).toEqual([11]);
        expect(counters(buf.push(12, frame(12)))).toEqual([12]);
    });

    it('holds an out-of-order frame until the gap fills, then drains in order', () => {
        const buf: VoiceReorderBuffer = new VoiceReorderBuffer();
        expect(counters(buf.push(10, frame(10)))).toEqual([10]);
        // 12 arrives before 11 — held, nothing emitted.
        expect(counters(buf.push(12, frame(12)))).toEqual([]);
        expect(buf.buffered).toBe(1);
        // 11 fills the gap → 11 and 12 flush in order.
        expect(counters(buf.push(11, frame(11)))).toEqual([11, 12]);
        expect(buf.buffered).toBe(0);
    });

    it('drops late/duplicate frames', () => {
        const buf: VoiceReorderBuffer = new VoiceReorderBuffer();
        buf.push(10, frame(10));
        buf.push(11, frame(11));
        expect(counters(buf.push(10, frame(10)))).toEqual([]); // already played
        expect(counters(buf.push(11, frame(11)))).toEqual([]); // duplicate
    });

    it('skips a lost frame once too many are held, recovering playback', () => {
        const buf: VoiceReorderBuffer = new VoiceReorderBuffer({ maxBuffered: 3 });
        expect(counters(buf.push(0, frame(0)))).toEqual([0]);
        // 1 is lost forever; 2,3,4 arrive and are held.
        expect(counters(buf.push(2, frame(2)))).toEqual([]);
        expect(counters(buf.push(3, frame(3)))).toEqual([]);
        expect(counters(buf.push(4, frame(4)))).toEqual([]);
        // 4th held frame exceeds maxBuffered=3 → skip ahead to oldest (2) and drain.
        const out: number[] = counters(buf.push(5, frame(5)));
        expect(out).toEqual([2, 3, 4, 5]);
        expect(buf.buffered).toBe(0);
    });

    it('emits talk-stop on an empty frame, flushing held frames first, then resyncs', () => {
        const buf: VoiceReorderBuffer = new VoiceReorderBuffer();
        buf.push(10, frame(10));
        buf.push(12, frame(12)); // held (waiting for 11)
        const events: VoiceEvent[] = buf.push(13, Buffer.alloc(0)); // talk-stop
        // Held 12 flushes, then talk-stop.
        expect(events.map((e) => e.type)).toEqual(['frame', 'talk-stop']);
        expect(counters(events)).toEqual([12]);
        // A new spurt re-seeds from its first counter.
        expect(counters(buf.push(100, frame(100)))).toEqual([100]);
    });

    it('handles the u16 wrap across a spurt boundary', () => {
        const buf: VoiceReorderBuffer = new VoiceReorderBuffer();
        expect(counters(buf.push(0xfffe, frame(0xfe)))).toEqual([0xfffe]);
        expect(counters(buf.push(0xffff, frame(0xff)))).toEqual([0xffff]);
        expect(counters(buf.push(0x0000, frame(0x00)))).toEqual([0x0000]);
        expect(counters(buf.push(0x0001, frame(0x01)))).toEqual([0x0001]);
    });
});
