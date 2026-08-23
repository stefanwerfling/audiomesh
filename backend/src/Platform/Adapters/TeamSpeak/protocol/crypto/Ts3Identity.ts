import {
    createHash,
    createPrivateKey,
    createPublicKey,
    diffieHellman,
    generateKeyPairSync,
    type JsonWebKey,
    type KeyObject,
} from 'node:crypto';
import { Buffer } from 'node:buffer';

/**
 * TeamSpeak's public-key ("omega") ASN.1/DER layout — **not** SPKI. Verbatim from
 * TSLib `TsCrypt.ExportPublicKey` (`../PROTOCOL.md` §4.1):
 *
 * ```
 * SEQUENCE {
 *   BIT STRING { 0x00 }, 7 unused bits   // LibTomCrypt: 0 = a public key
 *   INTEGER   32                         // LibTomCrypt key size marker
 *   INTEGER   affineX                    // public point X
 *   INTEGER   affineY                    // public point Y
 * }
 * ```
 *
 * The import path reads X at sequence index 2 and Y at index 3. This compact form
 * (~108 base64 chars vs SPKI's ~124) is also what keeps the `clientinitiv` that
 * rides Init1 packet 4 under the 500-byte UDP MTU.
 */
const OMEGA_KEY_SIZE: number = 32;
/** `BIT STRING` value `0x00` with 7 unused bits → `03 02 07 00`. */
const OMEGA_BIT_STRING: Buffer = Buffer.from([0x03, 0x02, 0x07, 0x00]);
/** P-256 coordinates are 32 bytes. */
const COORDINATE_BYTES: number = 32;

/** Encode a DER length (short form, or long form for ≥128). */
function derLength(length: number): Buffer {
    if (length < 0x80) {
        return Buffer.from([length]);
    }
    if (length <= 0xff) {
        return Buffer.from([0x81, length]);
    }
    return Buffer.from([0x82, (length >> 8) & 0xff, length & 0xff]);
}

/** Encode a non-negative big-endian magnitude as a DER INTEGER (adds a sign byte). */
function derInteger(magnitude: Buffer): Buffer {
    let start: number = 0;
    while (start < magnitude.length - 1 && magnitude[start] === 0) {
        start += 1;
    }
    let content: Buffer = magnitude.subarray(start);
    if (((content[0] ?? 0) & 0x80) !== 0) {
        content = Buffer.concat([Buffer.from([0x00]), content]);
    }
    return Buffer.concat([Buffer.from([0x02]), derLength(content.length), content]);
}

/** Wrap DER elements in a SEQUENCE. */
function derSequence(elements: Buffer[]): Buffer {
    const body: Buffer = Buffer.concat(elements);
    return Buffer.concat([Buffer.from([0x30]), derLength(body.length), body]);
}

interface Tlv {
    tag: number;
    content: Buffer;
    next: number;
}

/** Read one DER tag-length-value at `offset`. */
function readTlv(buffer: Buffer, offset: number): Tlv {
    const tag: number = buffer[offset] ?? 0;
    let length: number = buffer[offset + 1] ?? 0;
    let cursor: number = offset + 2;
    if ((length & 0x80) !== 0) {
        const byteCount: number = length & 0x7f;
        length = 0;
        for (let i: number = 0; i < byteCount; i++) {
            length = (length << 8) | (buffer[cursor] ?? 0);
            cursor += 1;
        }
    }
    return { tag: tag, content: buffer.subarray(cursor, cursor + length), next: cursor + length };
}

/** Split a DER SEQUENCE into its top-level element contents. */
function derSequenceElements(der: Buffer): Buffer[] {
    const sequence: Tlv = readTlv(der, 0);
    if (sequence.tag !== 0x30) {
        throw new Error('Ts3Identity: omega is not an ASN.1 SEQUENCE');
    }
    const elements: Buffer[] = [];
    let offset: number = 0;
    while (offset < sequence.content.length) {
        const element: Tlv = readTlv(sequence.content, offset);
        elements.push(element.content);
        offset = element.next;
    }
    return elements;
}

/** Strip a DER INTEGER's sign byte and left-pad to a fixed 32-byte coordinate. */
function toCoordinate(raw: Buffer): Buffer {
    let value: Buffer = raw;
    while (value.length > COORDINATE_BYTES && value[0] === 0) {
        value = value.subarray(1);
    }
    if (value.length < COORDINATE_BYTES) {
        value = Buffer.concat([Buffer.alloc(COORDINATE_BYTES - value.length), value]);
    }
    return value;
}

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

    /**
     * `omega` — base64 of the public key in TeamSpeak's LibTomCrypt ASN.1 format
     * (`SEQUENCE { BIT STRING, INTEGER 32, INTEGER x, INTEGER y }`), **not** SPKI.
     * This is the exact byte layout a real TS3 server parses for the UID and ECDH.
     */
    public omega(): string {
        const point: { x: Buffer; y: Buffer } = this._publicPoint();
        const der: Buffer = derSequence([
            OMEGA_BIT_STRING,
            derInteger(Buffer.from([OMEGA_KEY_SIZE])),
            derInteger(point.x),
            derInteger(point.y),
        ]);
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
     * ECDH shared secret with a server public key given as a TeamSpeak `omega` DER
     * (see the class-level layout): parse the affine X/Y at sequence indices 2/3,
     * rebuild the P-256 point, and return the affine X of `serverPublic · thisPrivate`
     * — the `x` fed into SHA1 to seed the SharedIV (`../PROTOCOL.md` §4.4).
     */
    public sharedSecretX(serverOmegaDer: Buffer): Buffer {
        const elements: Buffer[] = derSequenceElements(serverOmegaDer);
        if (elements.length < 4) {
            throw new Error('Ts3Identity: malformed omega (expected 4 ASN.1 elements)');
        }
        const x: Buffer = toCoordinate(elements[2] as Buffer);
        const y: Buffer = toCoordinate(elements[3] as Buffer);
        const serverPublic: KeyObject = createPublicKey({
            key: {
                kty: 'EC',
                crv: 'P-256',
                x: x.toString('base64url'),
                y: y.toString('base64url'),
            },
            format: 'jwk',
        });
        return diffieHellman({ privateKey: this._privateKey, publicKey: serverPublic });
    }

    /** The public key's affine X/Y coordinates as fixed 32-byte buffers. */
    private _publicPoint(): { x: Buffer; y: Buffer } {
        const jwk: JsonWebKey = this._publicKey.export({ format: 'jwk' });
        if (jwk.x === undefined || jwk.y === undefined) {
            throw new Error('Ts3Identity: public key has no EC coordinates');
        }
        return {
            x: toCoordinate(Buffer.from(jwk.x, 'base64url')),
            y: toCoordinate(Buffer.from(jwk.y, 'base64url')),
        };
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
