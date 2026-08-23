import { Buffer } from 'node:buffer';
import { describe, expect, it } from 'vitest';
import {
    eaxDecrypt,
    eaxEncrypt,
} from '../../../../src/Platform/Adapters/TeamSpeak/protocol/crypto/Eax.js';

const hex = (s: string): Buffer => Buffer.from(s, 'hex');

/**
 * Authoritative EAX test vectors (Bellare–Rogaway–Wagner, "The EAX Mode of
 * Operation", Appendix). Each `CIPHER` is ciphertext ‖ 16-byte tag.
 */
const VECTORS: { key: string; nonce: string; header: string; msg: string; cipher: string }[] = [
    {
        key: '233952DEE4D5ED5F9B9C6D6FF80FF478',
        nonce: '62EC67F9C3A4A407FCB2A8C49031A8B3',
        header: '6BFB914FD07EAE6B',
        msg: '',
        cipher: 'E037830E8389F27B025A2D6527E79D01',
    },
    {
        key: '91945D3F4DCBEE0BF45EF52255F095A4',
        nonce: 'BECAF043B0A23D843194BA972C66DEBD',
        header: 'FA3BFD4806EB53FA',
        msg: 'F7FB',
        cipher: '19DD5C4C9331049D0BDAB0277408F67967E5',
    },
    {
        key: '01F74AD64077F2E704C0F60ADA3DD523',
        nonce: '70C3DB4F0D26368400A10ED05D2BFF5E',
        header: '234A3463C1264AC6',
        msg: '1A47CB4933',
        cipher: 'D851D5BAE03A59F238A23E39199DC9266626C40F80',
    },
];

describe('eax (spec test vectors, full 16-byte tag)', () => {
    for (const [i, v] of VECTORS.entries()) {
        it(`vector ${i + 1}: encrypt matches ciphertext‖tag`, () => {
            const { ciphertext, tag } = eaxEncrypt(
                hex(v.key),
                hex(v.nonce),
                hex(v.header),
                hex(v.msg),
                16,
            );
            expect(Buffer.concat([ciphertext, tag]).toString('hex').toUpperCase()).toBe(v.cipher);
        });

        it(`vector ${i + 1}: decrypt recovers the plaintext`, () => {
            const full: Buffer = hex(v.cipher);
            const ciphertext: Buffer = full.subarray(0, full.length - 16);
            const tag: Buffer = full.subarray(full.length - 16);
            const plain: Buffer = eaxDecrypt(
                hex(v.key),
                hex(v.nonce),
                hex(v.header),
                ciphertext,
                tag,
            );
            expect(plain.toString('hex').toUpperCase()).toBe(v.msg);
        });
    }
});

describe('eax with an 8-byte tag (TS3 MacLen)', () => {
    const key: Buffer = hex('91945D3F4DCBEE0BF45EF52255F095A4');
    const nonce: Buffer = hex('BECAF043B0A23D843194BA972C66DEBD');
    const header: Buffer = Buffer.from('header-as-associated-data');
    const msg: Buffer = Buffer.from('clientinit client_nickname=Bot');

    it('round-trips and truncates the tag to 8 bytes', () => {
        const { ciphertext, tag } = eaxEncrypt(key, nonce, header, msg, 8);
        expect(tag.length).toBe(8);
        expect(eaxDecrypt(key, nonce, header, ciphertext, tag).toString()).toBe(msg.toString());
    });

    it('rejects a tampered tag', () => {
        const { ciphertext, tag } = eaxEncrypt(key, nonce, header, msg, 8);
        const bad: Buffer = Buffer.from(tag);
        bad[0] = bad[0]! ^ 0xff;
        expect(() => eaxDecrypt(key, nonce, header, ciphertext, bad)).toThrow(/tag mismatch/);
    });

    it('rejects when the associated data differs', () => {
        const { ciphertext, tag } = eaxEncrypt(key, nonce, header, msg, 8);
        expect(() =>
            eaxDecrypt(key, nonce, Buffer.from('different-header'), ciphertext, tag),
        ).toThrow(/tag mismatch/);
    });
});
