import { Buffer } from 'node:buffer';
import { flagsFromByte, type PacketType, toTypeFlagsByte, typeFromByte } from './PacketType.js';

/**
 * Low-level TS3 packet (de)serialization — the pure, crypto-free codec for the
 * wire frame `[ MAC(8) ][ Header ][ Data ]`. See `../PROTOCOL.md` §2.1.
 *
 * The header differs by direction: a client→server packet carries its own client
 * id (5-byte header), a server→client packet does not (3-byte header). The `MAC`
 * is opaque here — it is either the 8-byte EAX tag or the fixed fake signature,
 * both produced/verified by the crypto layer, which sits above this codec.
 *
 * These functions do no encryption, compression, or reassembly; they only move
 * bytes between the {@link Ts3Packet} struct and a `Buffer`.
 */

/** Length of the leading MAC (EAX tag / fake signature) on every packet. */
export const MAC_LENGTH: number = 8;
/** Header length for a client→server packet: packetId(2) + clientId(2) + type(1). */
export const HEADER_LENGTH_C2S: number = 5;
/** Header length for a server→client packet: packetId(2) + type(1). */
export const HEADER_LENGTH_S2C: number = 3;

/** Which way a packet travels — decides whether the header carries a client id. */
export const PacketDirection = {
    ClientToServer: 'C2S',
    ServerToClient: 'S2C',
} as const;
export type PacketDirection = (typeof PacketDirection)[keyof typeof PacketDirection];

/** A decoded/decodable TS3 packet. `clientId` is meaningful C2S only (0 for S2C). */
export interface Ts3Packet {
    /** 8-byte MAC (EAX tag or fake signature). */
    mac: Buffer;
    /** Per-(direction,type) u16 packet counter. */
    packetId: number;
    /** Client id (C2S header only); 0 on server→client packets. */
    clientId: number;
    type: PacketType;
    /** Raw flag bits (high nibble): FR/NP/CP/UE. */
    flags: number;
    /** Packet payload after the header (still encrypted/compressed as flagged). */
    data: Buffer;
}

/** Header length in bytes for the given direction. */
export function headerLength(direction: PacketDirection): number {
    return direction === PacketDirection.ClientToServer ? HEADER_LENGTH_C2S : HEADER_LENGTH_S2C;
}

/** Total wire length (MAC + header + data) a packet occupies in the given direction. */
export function packetLength(direction: PacketDirection, dataLength: number): number {
    return MAC_LENGTH + headerLength(direction) + dataLength;
}

/**
 * Serialize a {@link Ts3Packet} into its wire `Buffer` for the given direction.
 * `packetId` and `clientId` are written big-endian; `clientId` is emitted only for
 * client→server packets. Throws when the MAC is not exactly 8 bytes.
 */
export function encodePacket(direction: PacketDirection, packet: Ts3Packet): Buffer {
    if (packet.mac.length !== MAC_LENGTH) {
        throw new Error(`Ts3Packet: MAC must be ${MAC_LENGTH} bytes, got ${packet.mac.length}`);
    }
    const typeFlags: number = toTypeFlagsByte(packet.type, packet.flags);
    const out: Buffer = Buffer.alloc(packetLength(direction, packet.data.length));
    packet.mac.copy(out, 0, 0, MAC_LENGTH);
    out.writeUInt16BE(packet.packetId & 0xffff, MAC_LENGTH);
    if (direction === PacketDirection.ClientToServer) {
        out.writeUInt16BE(packet.clientId & 0xffff, MAC_LENGTH + 2);
        out.writeUInt8(typeFlags, MAC_LENGTH + 4);
        packet.data.copy(out, MAC_LENGTH + HEADER_LENGTH_C2S);
    } else {
        out.writeUInt8(typeFlags, MAC_LENGTH + 2);
        packet.data.copy(out, MAC_LENGTH + HEADER_LENGTH_S2C);
    }
    return out;
}

/**
 * Parse a wire `Buffer` into a {@link Ts3Packet} for the given direction. The
 * returned `mac` and `data` are views onto `raw` (no copy) — callers that retain
 * them past the socket callback should copy. Throws when the buffer is shorter
 * than MAC + header.
 */
export function decodePacket(direction: PacketDirection, raw: Buffer): Ts3Packet {
    const minLength: number = MAC_LENGTH + headerLength(direction);
    if (raw.length < minLength) {
        throw new Error(
            `Ts3Packet: buffer too short (${raw.length} < ${minLength}) for ${direction}`,
        );
    }
    const mac: Buffer = raw.subarray(0, MAC_LENGTH);
    const packetId: number = raw.readUInt16BE(MAC_LENGTH);
    let clientId: number = 0;
    let typeFlags: number;
    let data: Buffer;
    if (direction === PacketDirection.ClientToServer) {
        clientId = raw.readUInt16BE(MAC_LENGTH + 2);
        typeFlags = raw.readUInt8(MAC_LENGTH + 4);
        data = raw.subarray(MAC_LENGTH + HEADER_LENGTH_C2S);
    } else {
        typeFlags = raw.readUInt8(MAC_LENGTH + 2);
        data = raw.subarray(MAC_LENGTH + HEADER_LENGTH_S2C);
    }
    return {
        mac: mac,
        packetId: packetId,
        clientId: clientId,
        type: typeFromByte(typeFlags),
        flags: flagsFromByte(typeFlags),
        data: data,
    };
}
