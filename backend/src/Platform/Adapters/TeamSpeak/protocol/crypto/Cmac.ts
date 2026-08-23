import { createCipheriv } from 'node:crypto';
import { Buffer } from 'node:buffer';

/**
 * AES-128-CMAC (RFC 4493) — the block-cipher MAC that EAX (`./Eax.ts`) is built
 * from. Node exposes no CMAC primitive, so we implement it over single-block
 * AES-128-ECB. Validated against the RFC 4493 test vectors.
 */

const BLOCK_SIZE: number = 16;
/** The GF(2^128) reduction constant for 128-bit blocks (RFC 4493 §2.3). */
const RB: number = 0x87;

/** Encrypt one 16-byte block with AES-128 in ECB (no padding) — the CMAC core. */
function aesEcbBlock(key: Buffer, block: Buffer): Buffer {
    const cipher = createCipheriv('aes-128-ecb', key, null);
    cipher.setAutoPadding(false);
    return Buffer.concat([cipher.update(block), cipher.final()]);
}

/** Left-shift a big-endian 16-byte value by one bit (carry out of the top is dropped). */
function shiftLeft1(input: Buffer): Buffer {
    const out: Buffer = Buffer.alloc(input.length);
    let carry: number = 0;
    for (let i: number = input.length - 1; i >= 0; i--) {
        const byte: number = input[i] as number;
        out[i] = ((byte << 1) | carry) & 0xff;
        carry = (byte >> 7) & 1;
    }
    return out;
}

/** XOR two equal-length buffers into a fresh buffer. */
function xor(a: Buffer, b: Buffer): Buffer {
    const out: Buffer = Buffer.alloc(a.length);
    for (let i: number = 0; i < a.length; i++) {
        out[i] = (a[i] as number) ^ (b[i] as number);
    }
    return out;
}

/** Derive the CMAC subkeys K1, K2 from the block-cipher key (RFC 4493 §2.3). */
function generateSubkeys(key: Buffer): [Buffer, Buffer] {
    const l: Buffer = aesEcbBlock(key, Buffer.alloc(BLOCK_SIZE));
    const k1: Buffer = shiftLeft1(l);
    if ((l[0] as number) & 0x80) {
        k1[BLOCK_SIZE - 1] = (k1[BLOCK_SIZE - 1] as number) ^ RB;
    }
    const k2: Buffer = shiftLeft1(k1);
    if ((k1[0] as number) & 0x80) {
        k2[BLOCK_SIZE - 1] = (k2[BLOCK_SIZE - 1] as number) ^ RB;
    }
    return [k1, k2];
}

/**
 * Compute the 16-byte AES-128-CMAC of `message` under `key` (RFC 4493). An empty
 * message is handled as the single-padded-block case, exactly per spec.
 */
export function aesCmac(key: Buffer, message: Buffer): Buffer {
    const [k1, k2] = generateSubkeys(key);

    const blockCount: number = Math.ceil(message.length / BLOCK_SIZE);
    const lastIsComplete: boolean = message.length > 0 && message.length % BLOCK_SIZE === 0;
    const totalBlocks: number = blockCount === 0 ? 1 : blockCount;

    // Build the final block M_last from the last (possibly padded) message block.
    const lastStart: number = (totalBlocks - 1) * BLOCK_SIZE;
    let mLast: Buffer;
    if (lastIsComplete) {
        mLast = xor(message.subarray(lastStart, lastStart + BLOCK_SIZE), k1);
    } else {
        const tail: Buffer = message.subarray(lastStart);
        const padded: Buffer = Buffer.alloc(BLOCK_SIZE);
        tail.copy(padded, 0);
        padded[tail.length] = 0x80;
        mLast = xor(padded, k2);
    }

    let x: Buffer = Buffer.alloc(BLOCK_SIZE);
    for (let i: number = 0; i < totalBlocks - 1; i++) {
        const block: Buffer = message.subarray(i * BLOCK_SIZE, (i + 1) * BLOCK_SIZE);
        x = aesEcbBlock(key, xor(x, block));
    }
    return aesEcbBlock(key, xor(x, mLast));
}
