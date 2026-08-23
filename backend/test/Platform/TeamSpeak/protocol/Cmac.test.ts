import { Buffer } from 'node:buffer';
import { describe, expect, it } from 'vitest';
import { aesCmac } from '../../../../src/Platform/Adapters/TeamSpeak/protocol/crypto/Cmac.js';

/** RFC 4493 test vectors (AES-128-CMAC), key 2b7e1516…. */
const KEY: Buffer = Buffer.from('2b7e151628aed2a6abf7158809cf4f3c', 'hex');
const M: Buffer = Buffer.from(
    '6bc1bee22e409f96e93d7e117393172aae2d8a571e03ac9c9eb76fac45af8e51' +
        '30c81c46a35ce411e5fbc1191a0a52eff69f2445df4f9b17ad2b417be66c3710',
    'hex',
);

describe('aesCmac (RFC 4493 vectors)', () => {
    it('example 1: empty message', () => {
        expect(aesCmac(KEY, Buffer.alloc(0)).toString('hex')).toBe(
            'bb1d6929e95937287fa37d129b756746',
        );
    });

    it('example 2: 16-byte message (one complete block)', () => {
        expect(aesCmac(KEY, M.subarray(0, 16)).toString('hex')).toBe(
            '070a16b46b4d4144f79bdd9dd04a287c',
        );
    });

    it('example 3: 40-byte message (partial last block)', () => {
        expect(aesCmac(KEY, M.subarray(0, 40)).toString('hex')).toBe(
            'dfa66747de9ae63030ca32611497c827',
        );
    });

    it('example 4: 64-byte message (four complete blocks)', () => {
        expect(aesCmac(KEY, M.subarray(0, 64)).toString('hex')).toBe(
            '51f0bebf7e3b9d92fc49741779363cfe',
        );
    });
});
