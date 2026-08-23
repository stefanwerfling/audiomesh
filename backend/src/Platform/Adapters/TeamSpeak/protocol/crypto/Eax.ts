import { createCipheriv, timingSafeEqual } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { aesCmac } from './Cmac.js';

/**
 * AES-128-EAX authenticated encryption (Bellare–Rogaway–Wagner). TS3 encrypts
 * every command/ack — and, depending on the server's CodecEncryptionMode, voice —
 * with AES-128 in EAX mode, an 8-byte tag, and the packet header as associated
 * data (`../PROTOCOL.md` §4.7). Node has no native EAX, so we compose it from
 * OMAC (AES-CMAC) + AES-CTR. Validated against the EAX specification test vectors.
 *
 * EAX(key, N, H, M): C = CTR_key(OMAC^0(N), M);
 *                    Tag = OMAC^0(N) ⊕ OMAC^1(H) ⊕ OMAC^2(C).
 */

const BLOCK_SIZE: number = 16;

/** OMAC^t(msg) = CMAC(key, [t]_128 || msg), with t as a 16-byte big-endian prefix. */
function omac(key: Buffer, t: number, message: Buffer): Buffer {
    const prefixed: Buffer = Buffer.alloc(BLOCK_SIZE + message.length);
    prefixed[BLOCK_SIZE - 1] = t & 0xff; // t ∈ {0,1,2} fits the last byte
    message.copy(prefixed, BLOCK_SIZE);
    return aesCmac(key, prefixed);
}

/** AES-128-CTR with a full 128-bit big-endian counter starting at `iv`. */
function aesCtr(key: Buffer, iv: Buffer, data: Buffer): Buffer {
    const cipher = createCipheriv('aes-128-ctr', key, iv);
    return Buffer.concat([cipher.update(data), cipher.final()]);
}

function xor(a: Buffer, b: Buffer): Buffer {
    const out: Buffer = Buffer.alloc(a.length);
    for (let i: number = 0; i < a.length; i++) {
        out[i] = (a[i] as number) ^ (b[i] as number);
    }
    return out;
}

export interface EaxResult {
    ciphertext: Buffer;
    /** Authentication tag, truncated to `tagLength` bytes. */
    tag: Buffer;
}

/**
 * EAX-encrypt `plaintext` under `key` with nonce `nonce` and associated data
 * `header`. Returns the ciphertext and a `tagLength`-byte tag (default 8, TS3's
 * MacLen). `nonce`, `header` and `plaintext` may each be empty.
 */
export function eaxEncrypt(
    key: Buffer,
    nonce: Buffer,
    header: Buffer,
    plaintext: Buffer,
    tagLength: number = 8,
): EaxResult {
    const nOmac: Buffer = omac(key, 0, nonce);
    const hOmac: Buffer = omac(key, 1, header);
    const ciphertext: Buffer = aesCtr(key, nOmac, plaintext);
    const cOmac: Buffer = omac(key, 2, ciphertext);
    const fullTag: Buffer = xor(xor(nOmac, hOmac), cOmac);
    return { ciphertext: ciphertext, tag: fullTag.subarray(0, tagLength) };
}

/**
 * EAX-decrypt `ciphertext`, verifying `tag` against `(key, nonce, header)`.
 * Returns the plaintext, or throws when authentication fails. The tag is compared
 * in constant time; its length sets how many tag bytes are checked.
 */
export function eaxDecrypt(
    key: Buffer,
    nonce: Buffer,
    header: Buffer,
    ciphertext: Buffer,
    tag: Buffer,
): Buffer {
    const nOmac: Buffer = omac(key, 0, nonce);
    const hOmac: Buffer = omac(key, 1, header);
    const cOmac: Buffer = omac(key, 2, ciphertext);
    const expected: Buffer = xor(xor(nOmac, hOmac), cOmac).subarray(0, tag.length);
    if (expected.length !== tag.length || !timingSafeEqual(expected, tag)) {
        throw new Error('Eax: authentication tag mismatch');
    }
    return aesCtr(key, nOmac, ciphertext);
}
