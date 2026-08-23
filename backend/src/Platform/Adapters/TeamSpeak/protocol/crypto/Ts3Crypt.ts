import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';
import type { PacketType } from '../packet/PacketType.js';
import { eaxDecrypt, eaxEncrypt } from './Eax.js';

/**
 * TS3 packet cryptography (`../PROTOCOL.md` §4) — the stateful core that turns the
 * handshake's shared secret into per-packet AES-128-EAX keys and seals/opens
 * packets. It owns the `SharedIV` (`ivStruct`), the 8-byte fake signature used on
 * unencrypted packets, and the `cryptoInitComplete` flag.
 *
 * Only the **old protocol (<3.1)** shared-secret derivation is implemented here;
 * the ≥3.1 license-chain/Curve25519 path (`../PROTOCOL.md` §4.5) is a follow-up.
 * Before the shared secret is set, every packet uses the fixed "fake" key/nonce.
 */

/** Fixed pre-handshake key: first 16 bytes of `c:\windows\system\firewall32.cpl`. */
export const DUMMY_KEY: Buffer = Buffer.from('c:\\windows\\syste', 'latin1');
/** Fixed pre-handshake nonce: last 16 bytes of the same string. */
export const DUMMY_IV: Buffer = Buffer.from('m\\firewall32.cpl', 'latin1');

/** TS3's EAX tag length (MacLen) — 8 bytes. */
const MAC_LENGTH: number = 8;

export interface KeyNonce {
    key: Buffer;
    nonce: Buffer;
}

function sha1(data: Buffer): Buffer {
    return createHash('sha1').update(data).digest();
}

function sha256(data: Buffer): Buffer {
    return createHash('sha256').update(data).digest();
}

export class Ts3Crypt {
    private _ivStruct: Buffer | null = null;
    private _fakeSignature: Buffer | null = null;
    private _cryptoInitComplete: boolean = false;

    public get cryptoInitComplete(): boolean {
        return this._cryptoInitComplete;
    }

    /** The 8-byte fake signature (MAC for unencrypted packets). Throws before setup. */
    public get fakeSignature(): Buffer {
        if (this._fakeSignature === null) {
            throw new Error('Ts3Crypt: shared secret not set up yet');
        }
        return this._fakeSignature;
    }

    /** Reset to the pre-handshake state (e.g. on reconnect). */
    public reset(): void {
        this._ivStruct = null;
        this._fakeSignature = null;
        this._cryptoInitComplete = false;
    }

    /**
     * Old-protocol shared-secret setup (`../PROTOCOL.md` §4.4): derive the SharedIV
     * from the ECDH x-coordinate mixed with the handshake `alpha`/`beta` nonces, and
     * the fake signature from it. `sharedX` is {@link Ts3Identity.sharedSecretX}'s
     * output; `alpha` is 10 bytes, `beta` is 10 bytes (old protocol).
     */
    public setupSharedSecret(sharedX: Buffer, alpha: Buffer, beta: Buffer): void {
        const sharedKey: Buffer = sha1(sharedX); // 20 bytes
        const ivStruct: Buffer = Buffer.alloc(10 + beta.length);
        for (let i: number = 0; i < 10; i++) {
            ivStruct[i] = (sharedKey[i] as number) ^ (alpha[i] as number);
        }
        for (let i: number = 0; i < beta.length; i++) {
            ivStruct[10 + i] = (sharedKey[10 + i] as number) ^ (beta[i] as number);
        }
        this._ivStruct = ivStruct;
        this._fakeSignature = sha1(ivStruct).subarray(0, MAC_LENGTH);
        this._cryptoInitComplete = true;
    }

    /**
     * Derive the per-packet EAX `(key, nonce)` (`../PROTOCOL.md` §4.6). Before the
     * shared secret is set the fixed dummy key/nonce are used; either way the packet
     * id is XORed into the **key**'s first two bytes (a common reimplementation bug
     * is to XOR it into the nonce instead).
     */
    public getKeyNonce(
        fromServer: boolean,
        type: PacketType,
        packetId: number,
        generationId: number,
    ): KeyNonce {
        let key: Buffer;
        let nonce: Buffer;
        if (!this._cryptoInitComplete || this._ivStruct === null) {
            key = Buffer.from(DUMMY_KEY);
            nonce = Buffer.from(DUMMY_IV);
        } else {
            const temp: Buffer = Buffer.alloc(this._ivStruct.length === 20 ? 26 : 70);
            temp[0] = fromServer ? 0x30 : 0x31;
            temp[1] = type & 0x0f;
            temp.writeUInt32BE(generationId >>> 0, 2);
            this._ivStruct.copy(temp, 6);
            const h: Buffer = sha256(temp);
            key = Buffer.from(h.subarray(0, 16));
            nonce = Buffer.from(h.subarray(16, 32));
        }
        key[0] = (key[0] as number) ^ ((packetId >> 8) & 0xff);
        key[1] = (key[1] as number) ^ (packetId & 0xff);
        return { key: key, nonce: nonce };
    }

    /**
     * EAX-seal a packet: encrypt `data` with `header` as associated data and return
     * the 8-byte MAC + ciphertext for {@link encodePacket}.
     */
    public encrypt(
        header: Buffer,
        data: Buffer,
        keyNonce: KeyNonce,
    ): { mac: Buffer; data: Buffer } {
        const { ciphertext, tag } = eaxEncrypt(
            keyNonce.key,
            keyNonce.nonce,
            header,
            data,
            MAC_LENGTH,
        );
        return { mac: tag, data: ciphertext };
    }

    /**
     * EAX-open a packet: verify `mac` over `(header, data)` and return the plaintext.
     * Throws when authentication fails.
     */
    public decrypt(header: Buffer, mac: Buffer, data: Buffer, keyNonce: KeyNonce): Buffer {
        return eaxDecrypt(keyNonce.key, keyNonce.nonce, header, data, mac);
    }
}
