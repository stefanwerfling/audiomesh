import { Buffer } from 'node:buffer';
import { describe, expect, it } from 'vitest';
import {
    decodePacket,
    encodePacket,
    headerLength,
    MAC_LENGTH,
    packetLength,
    PacketDirection,
    type Ts3Packet,
} from '../../../../src/Platform/Adapters/TeamSpeak/protocol/packet/Ts3Packet.js';
import {
    flagsFromByte,
    hasFlag,
    PacketFlags,
    PacketType,
    toTypeFlagsByte,
    typeFromByte,
} from '../../../../src/Platform/Adapters/TeamSpeak/protocol/packet/PacketType.js';

const MAC: Buffer = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]);

describe('PacketType byte packing', () => {
    it('packs flags into the high nibble and type into the low nibble', () => {
        const byte: number = toTypeFlagsByte(
            PacketType.Command,
            PacketFlags.Newprotocol | PacketFlags.Compressed,
        );
        expect(byte).toBe(0x62); // 0x40 | 0x20 | 0x02
        expect(typeFromByte(byte)).toBe(PacketType.Command);
        expect(flagsFromByte(byte)).toBe(0x60);
    });

    it('recognises the fixed init1 type byte (unflagged)', () => {
        expect(toTypeFlagsByte(PacketType.Init1, PacketFlags.None)).toBe(0x08);
    });

    it('hasFlag matches only fully-set flags and never the None sentinel', () => {
        const flags: number = PacketFlags.Fragmented | PacketFlags.Unencrypted;
        expect(hasFlag(flags, PacketFlags.Fragmented)).toBe(true);
        expect(hasFlag(flags, PacketFlags.Unencrypted)).toBe(true);
        expect(hasFlag(flags, PacketFlags.Compressed)).toBe(false);
        expect(hasFlag(flags, PacketFlags.None)).toBe(false);
    });
});

describe('encode/decode round-trip', () => {
    it('round-trips a client→server packet (5-byte header with client id)', () => {
        const packet: Ts3Packet = {
            mac: MAC,
            packetId: 0x1234,
            clientId: 0x00ab,
            type: PacketType.Command,
            flags: PacketFlags.Newprotocol,
            data: Buffer.from('clientinit client_nickname=Bot'),
        };
        const wire: Buffer = encodePacket(PacketDirection.ClientToServer, packet);
        expect(wire.length).toBe(packetLength(PacketDirection.ClientToServer, packet.data.length));
        expect(wire.length).toBe(MAC_LENGTH + 5 + packet.data.length);

        const decoded: Ts3Packet = decodePacket(PacketDirection.ClientToServer, wire);
        expect(Buffer.compare(decoded.mac, MAC)).toBe(0);
        expect(decoded.packetId).toBe(0x1234);
        expect(decoded.clientId).toBe(0x00ab);
        expect(decoded.type).toBe(PacketType.Command);
        expect(decoded.flags).toBe(PacketFlags.Newprotocol);
        expect(decoded.data.toString()).toBe('clientinit client_nickname=Bot');
    });

    it('round-trips a server→client packet (3-byte header, no client id)', () => {
        const packet: Ts3Packet = {
            mac: MAC,
            packetId: 0xfffe,
            clientId: 0, // ignored S2C
            type: PacketType.Voice,
            flags: PacketFlags.Unencrypted,
            data: Buffer.from([0x00, 0x01, 0x02, 0x04, 0xde, 0xad]),
        };
        const wire: Buffer = encodePacket(PacketDirection.ServerToClient, packet);
        expect(wire.length).toBe(MAC_LENGTH + 3 + packet.data.length);

        const decoded: Ts3Packet = decodePacket(PacketDirection.ServerToClient, wire);
        expect(decoded.packetId).toBe(0xfffe);
        expect(decoded.clientId).toBe(0);
        expect(decoded.type).toBe(PacketType.Voice);
        expect(decoded.flags).toBe(PacketFlags.Unencrypted);
        expect(Buffer.compare(decoded.data, packet.data)).toBe(0);
    });

    it('writes packet id and client id big-endian', () => {
        const wire: Buffer = encodePacket(PacketDirection.ClientToServer, {
            mac: MAC,
            packetId: 0x0102,
            clientId: 0x0304,
            type: PacketType.Ping,
            flags: PacketFlags.None,
            data: Buffer.alloc(0),
        });
        // After the 8-byte MAC: [01 02][03 04][type].
        expect(wire[MAC_LENGTH]).toBe(0x01);
        expect(wire[MAC_LENGTH + 1]).toBe(0x02);
        expect(wire[MAC_LENGTH + 2]).toBe(0x03);
        expect(wire[MAC_LENGTH + 3]).toBe(0x04);
        expect(wire[MAC_LENGTH + 4]).toBe(0x04); // Ping, no flags
    });

    it('handles an empty payload (e.g. a Ping)', () => {
        const wire: Buffer = encodePacket(PacketDirection.ClientToServer, {
            mac: MAC,
            packetId: 1,
            clientId: 0,
            type: PacketType.Ping,
            flags: PacketFlags.None,
            data: Buffer.alloc(0),
        });
        const decoded: Ts3Packet = decodePacket(PacketDirection.ClientToServer, wire);
        expect(decoded.data.length).toBe(0);
        expect(decoded.type).toBe(PacketType.Ping);
    });
});

describe('validation', () => {
    it('rejects a MAC that is not exactly 8 bytes', () => {
        expect(() =>
            encodePacket(PacketDirection.ClientToServer, {
                mac: Buffer.alloc(7),
                packetId: 1,
                clientId: 0,
                type: PacketType.Ack,
                flags: PacketFlags.None,
                data: Buffer.alloc(0),
            }),
        ).toThrow(/MAC must be 8 bytes/);
    });

    it('rejects a buffer shorter than MAC + header', () => {
        // 8 (MAC) + 3 (S2C header) = 11 minimum; give 10.
        expect(() => decodePacket(PacketDirection.ServerToClient, Buffer.alloc(10))).toThrow(
            /too short/,
        );
        // C2S needs 13; give 12.
        expect(() => decodePacket(PacketDirection.ClientToServer, Buffer.alloc(12))).toThrow(
            /too short/,
        );
    });

    it('accepts the exact minimum length (empty data)', () => {
        expect(headerLength(PacketDirection.ServerToClient)).toBe(3);
        const decoded: Ts3Packet = decodePacket(PacketDirection.ServerToClient, Buffer.alloc(11));
        expect(decoded.data.length).toBe(0);
    });
});
