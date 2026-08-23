import { Buffer } from 'node:buffer';
import { describe, expect, it } from 'vitest';
import {
    DUMMY_IV,
    DUMMY_KEY,
    Ts3Crypt,
} from '../../../../src/Platform/Adapters/TeamSpeak/protocol/crypto/Ts3Crypt.js';
import { PacketType } from '../../../../src/Platform/Adapters/TeamSpeak/protocol/packet/PacketType.js';
import {
    encodeHeader,
    PacketDirection,
    type Ts3Packet,
} from '../../../../src/Platform/Adapters/TeamSpeak/protocol/packet/Ts3Packet.js';

describe('Ts3Crypt dummy constants', () => {
    it('uses the fixed 16-byte pre-handshake key and nonce', () => {
        expect(DUMMY_KEY).toHaveLength(16);
        expect(DUMMY_IV).toHaveLength(16);
        expect(DUMMY_KEY.toString('latin1')).toBe('c:\\windows\\syste');
        expect(DUMMY_IV.toString('latin1')).toBe('m\\firewall32.cpl');
        // The 32-char source string is split across the two.
        expect(DUMMY_KEY.toString('latin1') + DUMMY_IV.toString('latin1')).toBe(
            'c:\\windows\\system\\firewall32.cpl',
        );
    });
});

describe('Ts3Crypt.getKeyNonce', () => {
    it('before setup returns the dummy key/nonce with the packet id XORed into the key', () => {
        const crypt: Ts3Crypt = new Ts3Crypt();
        expect(crypt.cryptoInitComplete).toBe(false);
        const kn = crypt.getKeyNonce(false, PacketType.Command, 0x0102, 0);
        // key[0..2] = dummy XOR packetId big-endian; rest of key unchanged.
        expect(kn.key[0]).toBe((DUMMY_KEY[0] as number) ^ 0x01);
        expect(kn.key[1]).toBe((DUMMY_KEY[1] as number) ^ 0x02);
        expect(kn.key.subarray(2)).toEqual(DUMMY_KEY.subarray(2));
        expect(kn.nonce).toEqual(DUMMY_IV);
    });

    it('after setup derives a non-dummy key that varies by direction and packet id', () => {
        const crypt: Ts3Crypt = new Ts3Crypt();
        crypt.setupSharedSecret(Buffer.alloc(32, 9), Buffer.alloc(10, 1), Buffer.alloc(10, 2));
        expect(crypt.cryptoInitComplete).toBe(true);
        const a = crypt.getKeyNonce(false, PacketType.Command, 1, 0);
        const b = crypt.getKeyNonce(true, PacketType.Command, 1, 0);
        const c = crypt.getKeyNonce(false, PacketType.Command, 2, 0);
        expect(a.key.equals(DUMMY_KEY)).toBe(false);
        expect(a.key.equals(b.key)).toBe(false); // direction changes the key
        expect(a.key.equals(c.key)).toBe(false); // packet id changes the key
        expect(crypt.fakeSignature).toHaveLength(8);
    });
});

describe('Ts3Crypt packet seal / open', () => {
    const crypt: Ts3Crypt = new Ts3Crypt();
    crypt.setupSharedSecret(Buffer.alloc(32, 0x5a), Buffer.alloc(10, 3), Buffer.alloc(10, 4));

    const packet: Ts3Packet = {
        mac: Buffer.alloc(8),
        packetId: 0x00a1,
        clientId: 0x0007,
        type: PacketType.Command,
        flags: 0x00,
        data: Buffer.from('clientinit client_nickname=AudioMesh'),
    };
    const header: Buffer = encodeHeader(PacketDirection.ClientToServer, packet);

    it('round-trips: encrypt then decrypt recovers the plaintext', () => {
        const kn = crypt.getKeyNonce(false, packet.type, packet.packetId, 0);
        const sealed = crypt.encrypt(header, packet.data, kn);
        expect(sealed.mac).toHaveLength(8);
        expect(sealed.data.equals(packet.data)).toBe(false); // actually encrypted

        const kn2 = crypt.getKeyNonce(false, packet.type, packet.packetId, 0);
        const opened = crypt.decrypt(header, sealed.mac, sealed.data, kn2);
        expect(opened.toString()).toBe(packet.data.toString());
    });

    it('fails to open when the header (associated data) is tampered', () => {
        const kn = crypt.getKeyNonce(false, packet.type, packet.packetId, 0);
        const sealed = crypt.encrypt(header, packet.data, kn);
        const badHeader: Buffer = Buffer.from(header);
        badHeader[0] = (badHeader[0] as number) ^ 0xff;
        const kn2 = crypt.getKeyNonce(false, packet.type, packet.packetId, 0);
        expect(() => crypt.decrypt(badHeader, sealed.mac, sealed.data, kn2)).toThrow();
    });

    it('throws when the fake signature is read before setup', () => {
        expect(() => new Ts3Crypt().fakeSignature).toThrow(/not set up/);
    });
});
