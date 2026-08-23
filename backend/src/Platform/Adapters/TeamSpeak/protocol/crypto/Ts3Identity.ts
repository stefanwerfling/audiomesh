import {
    createHash,
    createPrivateKey,
    createPublicKey,
    diffieHellman,
    generateKeyPairSync,
    type KeyObject,
} from 'node:crypto';
import { Buffer } from 'node:buffer';

/**
 * A TeamSpeak client **identity** — a permanent NIST P-256 (secp256r1/prime256v1)
 * keypair (`../PROTOCOL.md` §4.1). It is used for the ECDH shared secret at
 * handshake and (later, new protocol) for ECDSA proofs. From the public key derive
 * `omega` (base64 of the SPKI DER), the client `UID`, and the hashcash "security
 * level".
 *
 * TS3's own obfuscated `.ini` identity import/export is a separate on-disk format
 * and is not implemented yet — for our bot we generate a fresh identity and persist
 * it in our own portable form via {@link export}/{@link fromExport}
 * (`keyOffset:base64(pkcs8DER)`). Importing an existing TS3 identity string is a
 * follow-up (see PROTOCOL.md §4.1 identity-file de-obfuscation).
 */
export class Ts3Identity {
    private readonly _privateKey: KeyObject;
    private readonly _publicKey: KeyObject;
    private _keyOffset: number;

    private constructor(privateKey: KeyObject, publicKey: KeyObject, keyOffset: number) {
        this._privateKey = privateKey;
        this._publicKey = publicKey;
        this._keyOffset = keyOffset;
    }

    /** Generate a fresh P-256 identity. `keyOffset` seeds the hashcash search. */
    public static generate(keyOffset: number = 0): Ts3Identity {
        const { privateKey, publicKey } = generateKeyPairSync('ec', {
            namedCurve: 'prime256v1',
        });
        return new Ts3Identity(privateKey, publicKey, keyOffset);
    }

    /** Restore an identity previously produced by {@link export}. */
    public static fromExport(serialized: string): Ts3Identity {
        const sep: number = serialized.indexOf(':');
        if (sep < 0) {
            throw new Error('Ts3Identity: malformed export (expected "keyOffset:base64")');
        }
        const keyOffset: number = Number.parseInt(serialized.slice(0, sep), 10);
        const der: Buffer = Buffer.from(serialized.slice(sep + 1), 'base64');
        const privateKey: KeyObject = createPrivateKey({ key: der, format: 'der', type: 'pkcs8' });
        const publicKey: KeyObject = createPublicKey(privateKey);
        return new Ts3Identity(privateKey, publicKey, Number.isFinite(keyOffset) ? keyOffset : 0);
    }

    /** Serialize to our portable form `keyOffset:base64(pkcs8DER)`. */
    public export(): string {
        const der: Buffer = this._privateKey.export({ type: 'pkcs8', format: 'der' }) as Buffer;
        return `${this._keyOffset}:${der.toString('base64')}`;
    }

    public get keyOffset(): number {
        return this._keyOffset;
    }

    /** `omega` — base64 of the public key's SPKI DER encoding. */
    public omega(): string {
        const der: Buffer = this._publicKey.export({ type: 'spki', format: 'der' }) as Buffer;
        return der.toString('base64');
    }

    /** Client UID = `base64( SHA1( ascii(omega) ) )`. */
    public uid(): string {
        return createHash('sha1').update(Buffer.from(this.omega(), 'ascii')).digest('base64');
    }

    /**
     * Hashcash security level = number of trailing-zero bits (LSB-first per byte)
     * of `SHA1( ascii(omega + keyOffset) )` (`../PROTOCOL.md` §4.1). Higher = more
     * proof-of-work spent.
     */
    public securityLevel(): number {
        return Ts3Identity._securityLevel(this.omega(), this._keyOffset);
    }

    /**
     * Brute-force `keyOffset` upward until {@link securityLevel} reaches `target`.
     * Mutates and returns the reached level. Cost grows ~2× per extra level.
     */
    public improveSecurityLevel(target: number): number {
        const omega: string = this.omega();
        let level: number = Ts3Identity._securityLevel(omega, this._keyOffset);
        while (level < target) {
            this._keyOffset += 1;
            level = Ts3Identity._securityLevel(omega, this._keyOffset);
        }
        return level;
    }

    /**
     * ECDH shared secret with a server public key (SPKI DER): the affine X of
     * `serverPublic · thisPrivate`, i.e. the raw `computeSecret` result — the `x`
     * fed into SHA1 to seed the SharedIV (`../PROTOCOL.md` §4.4).
     */
    public sharedSecretX(serverPublicSpkiDer: Buffer): Buffer {
        const serverPublic: KeyObject = createPublicKey({
            key: serverPublicSpkiDer,
            format: 'der',
            type: 'spki',
        });
        return diffieHellman({ privateKey: this._privateKey, publicKey: serverPublic });
    }

    private static _securityLevel(omega: string, keyOffset: number): number {
        const hash: Buffer = createHash('sha1')
            .update(Buffer.from(omega + String(keyOffset), 'ascii'))
            .digest();
        let bits: number = 0;
        for (const byte of hash) {
            if (byte === 0) {
                bits += 8;
                continue;
            }
            let b: number = byte;
            while ((b & 1) === 0) {
                bits += 1;
                b >>= 1;
            }
            break;
        }
        return bits;
    }
}
