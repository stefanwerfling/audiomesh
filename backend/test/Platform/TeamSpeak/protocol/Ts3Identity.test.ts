import { Buffer } from 'node:buffer';
import { describe, expect, it } from 'vitest';
import { Ts3Identity } from '../../../../src/Platform/Adapters/TeamSpeak/protocol/crypto/Ts3Identity.js';

describe('Ts3Identity', () => {
    it('derives a stable omega and uid from the key', () => {
        const id: Ts3Identity = Ts3Identity.generate();
        const omega: string = id.omega();
        expect(omega.length).toBeGreaterThan(0);
        // omega is the TS3/LibTomCrypt ASN.1 public key, not SPKI.
        expect(Buffer.from(omega, 'base64')[0]).toBe(0x30); // ASN.1 SEQUENCE
        // uid is base64(SHA1(...)) → 20-byte digest → 28-char base64.
        expect(id.uid()).toHaveLength(28);
        expect(id.uid()).toBe(id.uid());
    });

    it('encodes omega in the exact TS3 layout: SEQUENCE { BITSTRING, INTEGER 32, X, Y }', () => {
        const der: Buffer = Buffer.from(Ts3Identity.generate().omega(), 'base64');
        // SEQUENCE header.
        expect(der[0]).toBe(0x30);
        // First element is the BIT STRING 03 02 07 00 (value 0x00, 7 unused bits).
        const bitString: Buffer = der.subarray(2, 6);
        expect([...bitString]).toEqual([0x03, 0x02, 0x07, 0x00]);
        // Second element is INTEGER 32 (02 01 20).
        expect([...der.subarray(6, 9)]).toEqual([0x02, 0x01, 0x20]);
        // The compact form keeps clientinitiv (Init1 packet 4) under the 500 B MTU.
        expect(der.length).toBeLessThan(84);
    });

    it('round-trips through export / fromExport (same omega, uid, offset)', () => {
        const id: Ts3Identity = Ts3Identity.generate(7);
        const restored: Ts3Identity = Ts3Identity.fromExport(id.export());
        expect(restored.omega()).toBe(id.omega());
        expect(restored.uid()).toBe(id.uid());
        expect(restored.keyOffset).toBe(7);
    });

    it('computes the hashcash security level and can improve it', () => {
        const id: Ts3Identity = Ts3Identity.generate(0);
        expect(id.securityLevel()).toBeGreaterThanOrEqual(0);
        const reached: number = id.improveSecurityLevel(8);
        expect(reached).toBeGreaterThanOrEqual(8);
        expect(id.securityLevel()).toBe(reached);
        expect(id.keyOffset).toBeGreaterThan(0);
    });

    it('agrees on the ECDH shared X from both sides', () => {
        const a: Ts3Identity = Ts3Identity.generate();
        const b: Ts3Identity = Ts3Identity.generate();
        const aOmega: Buffer = Buffer.from(a.omega(), 'base64');
        const bOmega: Buffer = Buffer.from(b.omega(), 'base64');
        const xa: Buffer = a.sharedSecretX(bOmega);
        const xb: Buffer = b.sharedSecretX(aOmega);
        expect(xa.length).toBe(32);
        expect(Buffer.compare(xa, xb)).toBe(0);
    });

    it('rejects a malformed export', () => {
        expect(() => Ts3Identity.fromExport('no-separator')).toThrow(/malformed/);
    });
});
