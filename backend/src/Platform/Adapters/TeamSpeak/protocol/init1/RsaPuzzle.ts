import { Buffer } from 'node:buffer';

/**
 * The Init1 proof-of-work puzzle (`../PROTOCOL.md` §3): the server sends a 64-byte
 * base `x`, 64-byte modulus `n` and a `level`, and the client must return
 * `y = x^(2^level) mod n`, big-endian, left-padded to 64 bytes. `x^(2^level)` is
 * `level` successive modular squarings, so the cost is `level` (not `2^level`)
 * big-integer squarings — cheap for the small levels real servers use.
 */

/** Safety cap so a hostile `level` cannot make the client spin indefinitely. */
export const MAX_PUZZLE_LEVEL: number = 1 << 16;

/** Big-endian bytes → BigInt (empty buffer → 0). */
export function bufferToBigInt(buffer: Buffer): bigint {
    const hex: string = buffer.toString('hex');
    return hex.length === 0 ? 0n : BigInt(`0x${hex}`);
}

/** BigInt → big-endian buffer of exactly `byteLength`, left-padded. Throws on overflow. */
export function bigIntToBuffer(value: bigint, byteLength: number): Buffer {
    if (value < 0n) {
        throw new Error('RsaPuzzle: negative value');
    }
    let hex: string = value.toString(16);
    if (hex.length > byteLength * 2) {
        throw new Error(`RsaPuzzle: value overflows ${byteLength} bytes`);
    }
    hex = hex.padStart(byteLength * 2, '0');
    return Buffer.from(hex, 'hex');
}

/**
 * Solve the puzzle: return `y = x^(2^level) mod n` as a 64-byte big-endian buffer.
 * Computed as `level` modular squarings of `x`.
 */
export function solveRsaPuzzle(x: Buffer, n: Buffer, level: number): Buffer {
    if (!Number.isInteger(level) || level < 0) {
        throw new Error(`RsaPuzzle: invalid level ${level}`);
    }
    if (level > MAX_PUZZLE_LEVEL) {
        throw new Error(`RsaPuzzle: level ${level} exceeds cap ${MAX_PUZZLE_LEVEL}`);
    }
    const modulus: bigint = bufferToBigInt(n);
    if (modulus === 0n) {
        throw new Error('RsaPuzzle: modulus is zero');
    }
    let result: bigint = bufferToBigInt(x) % modulus;
    for (let i: number = 0; i < level; i++) {
        result = (result * result) % modulus;
    }
    return bigIntToBuffer(result, 64);
}
