import { Buffer } from 'node:buffer';
import { createPublicKey } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { Ts3Identity } from '../../../../src/Platform/Adapters/TeamSpeak/protocol/crypto/Ts3Identity.js';

describe('Ts3Identity', () => {
    it('derives a stable omega and uid from the key', () => {
        const id: Ts3Identity = Ts3Identity.generate();
        const omega: string = id.omega();
        expect(omega.length).toBeGreaterThan(0);
        // omega is valid base64 of an SPKI DER (round-trips through a public key).
        expect(() =>
            createPublicKey({ key: Buffer.from(omega, 'base64'), format: 'der', type: 'spki' }),
        ).not.toThrow();
        // uid is base64(SHA1(...)) → 20-byte digest → 28-char base64.
        expect(id.uid()).toHaveLength(28);
        expect(id.uid()).toBe(id.uid());
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
