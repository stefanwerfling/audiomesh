/**
 * TS3 packet types and header flags — the low-level taxonomy of the type+flags
 * byte that follows the header's ids. Values are verbatim from TSLib
 * (`TS3AudioBot/TSLib/Full/PacketType.cs`); see `../PROTOCOL.md` §2.2–2.3.
 *
 * The one type+flags byte packs **flags in the high nibble, the type in the low 4
 * bits**: `byte = (flags & 0xF0) | (type & 0x0F)`.
 */

/** Packet type — low 4 bits of the type+flags byte. */
export const PacketType = {
    Voice: 0x0,
    VoiceWhisper: 0x1,
    Command: 0x2,
    CommandLow: 0x3,
    Ping: 0x4,
    Pong: 0x5,
    Ack: 0x6,
    AckLow: 0x7,
    Init1: 0x8,
} as const;
export type PacketType = (typeof PacketType)[keyof typeof PacketType];

/** Header flags — high nibble of the type+flags byte. */
export const PacketFlags = {
    None: 0x00,
    /** Fragment of a split command (set on the first *and* last fragment). */
    Fragmented: 0x10,
    /** ≥3.1 "new protocol" marker. */
    Newprotocol: 0x20,
    /** Data is QuickLZ-compressed. */
    Compressed: 0x40,
    /** Data is not EAX-encrypted (carries the fake MAC instead). */
    Unencrypted: 0x80,
} as const;
export type PacketFlag = (typeof PacketFlags)[keyof typeof PacketFlags];

/** Low-nibble mask selecting the packet type out of the type+flags byte. */
export const TYPE_MASK: number = 0x0f;
/** High-nibble mask selecting the flag bits out of the type+flags byte. */
export const FLAGS_MASK: number = 0xf0;

/** Extract the {@link PacketType} from a type+flags byte. */
export function typeFromByte(typeFlags: number): PacketType {
    return (typeFlags & TYPE_MASK) as PacketType;
}

/** Extract the raw flag bits (high nibble) from a type+flags byte. */
export function flagsFromByte(typeFlags: number): number {
    return typeFlags & FLAGS_MASK;
}

/** Pack a type + flag bits into the single type+flags byte. */
export function toTypeFlagsByte(type: PacketType, flags: number): number {
    return (flags & FLAGS_MASK) | (type & TYPE_MASK);
}

/** True when every bit of `flag` is set in `flags` (false for `None`, 0x00). */
export function hasFlag(flags: number, flag: PacketFlag): boolean {
    return flag !== 0 && (flags & flag) === flag;
}
