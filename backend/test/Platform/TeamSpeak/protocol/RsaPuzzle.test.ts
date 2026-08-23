import { Buffer } from 'node:buffer';
import { describe, expect, it } from 'vitest';
import {
    bigIntToBuffer,
    bufferToBigInt,
    solveRsaPuzzle,
} from '../../../../src/Platform/Adapters/TeamSpeak/protocol/init1/RsaPuzzle.js';

/** A 64-byte big-endian buffer holding a small integer. */
const n64 = (value: bigint): Buffer => bigIntToBuffer(value, 64);

describe('bufferToBigInt / bigIntToBuffer', () => {
    it('round-trips values and left-pads to the fixed width', () => {
        expect(bufferToBigInt(Buffer.alloc(0))).toBe(0n);
        expect(bufferToBigInt(n64(256n))).toBe(256n);
        const buf: Buffer = bigIntToBuffer(256n, 64);
        expect(buf.length).toBe(64);
        expect(buf[63]).toBe(0x00);
        expect(buf[62]).toBe(0x01);
    });

    it('throws on overflow', () => {
        expect(() => bigIntToBuffer(0x1_0000n, 2)).toThrow(/overflow/);
    });
});

describe('solveRsaPuzzle', () => {
    it('computes x^(2^level) mod n when no reduction occurs', () => {
        // n is all-FF (huge), so 2^(2^3) = 2^8 = 256 is returned unreduced.
        const x: Buffer = n64(2n);
        const n: Buffer = Buffer.alloc(64, 0xff);
        expect(bufferToBigInt(solveRsaPuzzle(x, n, 3))).toBe(256n);
    });

    it('matches an independent modular computation with a small modulus', () => {
        const modulus: bigint = 97n;
        const base: bigint = 5n;
        const level: number = 4;
        // Reference: 5^(2^4) mod 97 computed straight.
        let expected: bigint = base % modulus;
        for (let i: number = 0; i < level; i++) {
            expected = (expected * expected) % modulus;
        }
        const y: Buffer = solveRsaPuzzle(n64(base), n64(modulus), level);
        expect(bufferToBigInt(y)).toBe(expected);
    });

    it('level 0 returns x mod n', () => {
        expect(bufferToBigInt(solveRsaPuzzle(n64(50n), n64(97n), 0))).toBe(50n);
    });

    it('rejects a level over the cap and a zero modulus', () => {
        expect(() => solveRsaPuzzle(n64(2n), n64(97n), 1 << 20)).toThrow(/exceeds cap/);
        expect(() => solveRsaPuzzle(n64(2n), n64(0n), 1)).toThrow(/modulus is zero/);
    });
});
