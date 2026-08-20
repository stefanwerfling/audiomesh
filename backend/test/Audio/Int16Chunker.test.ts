import { describe, expect, it } from 'vitest';
import { Int16Chunker } from '../../src/Audio/Int16Chunker.js';

describe('Int16Chunker', () => {
    it('emits full chunks and holds the remainder', () => {
        const c: Int16Chunker = new Int16Chunker(480);
        expect(c.push(new Int16Array(200).fill(1))).toHaveLength(0);
        const chunks = c.push(new Int16Array(1000).fill(1));
        // 1200 buffered -> two 480 chunks, 240 remain.
        expect(chunks).toHaveLength(2);
        expect(chunks[0]!.length).toBe(480);
        expect(chunks[1]!.length).toBe(480);
    });

    it('splits an exact multiple into equal chunks with nothing left', () => {
        const c: Int16Chunker = new Int16Chunker(480);
        const chunks = c.push(new Int16Array(960).fill(7));
        expect(chunks).toHaveLength(2);
        expect(c.flush()).toBeNull();
    });

    it('flush zero-pads the tail to a full chunk', () => {
        const c: Int16Chunker = new Int16Chunker(480);
        c.push(new Int16Array(100).fill(5));
        const tail = c.flush();
        expect(tail).not.toBeNull();
        expect(tail!.length).toBe(480);
        expect(tail![0]).toBe(5);
        expect(tail![99]).toBe(5);
        expect(tail![100]).toBe(0);
    });

    it('flush on an empty buffer returns null', () => {
        expect(new Int16Chunker(480).flush()).toBeNull();
    });

    it('rejects a non-positive size', () => {
        expect(() => new Int16Chunker(0)).toThrow();
    });
});
