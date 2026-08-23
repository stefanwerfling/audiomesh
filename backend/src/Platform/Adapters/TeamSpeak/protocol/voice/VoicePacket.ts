import { Buffer } from 'node:buffer';

/**
 * Voice packet payload (de)serialization — the pure, codec-free layout of the data
 * field inside a Voice/VoiceWhisper packet, after the low-level {@link Ts3Packet}
 * header and (optional) EAX decryption. See `../PROTOCOL.md` §6.1–6.2.
 *
 * The `voiceCounter` is a per-sender u16 that runs **independently of the packet
 * id** — it orders a talk spurt's frames so the receiver can reassemble/reorder
 * them (see {@link VoiceReorderBuffer}). Direction changes the layout: a
 * client→server voice payload omits the sender id (the server knows who we are from
 * the packet's client id), a server→client payload carries the originating client
 * id so the receiver can attribute the frame to a speaker.
 *
 * These functions move bytes only — no Opus encode/decode (that is the injected
 * {@link IOpusCodec} seam), no encryption (the crypto layer sits below).
 */

/** Audio codec id — the codec byte of a voice payload (`../PROTOCOL.md` §6.2). */
export const Codec = {
    SpeexNarrowband: 0,
    SpeexWideband: 1,
    SpeexUltraWideband: 2,
    CeltMono: 3,
    /** Opus at 48 kHz mono, VOIP tuning — the codec we send/receive. */
    OpusVoice: 4,
    /** Opus at 48 kHz stereo, music tuning. */
    OpusMusic: 5,
} as const;
export type Codec = (typeof Codec)[keyof typeof Codec];

/** client→server voice header: voiceCounter(2) + codec(1). Frame follows. */
export const VOICE_HEADER_C2S: number = 3;
/** server→client voice header: voiceCounter(2) + senderClientId(2) + codec(1). Frame follows. */
export const VOICE_HEADER_S2C: number = 5;

/** A parsed client→server voice payload (what we would send). */
export interface VoicePayloadC2S {
    /** Per-sender u16 spurt counter, independent of the packet id. */
    voiceCounter: number;
    codec: Codec;
    /** The raw codec frame (Opus bytes). Empty = talk-stop marker (§6.4). */
    frame: Buffer;
}

/** A parsed server→client voice payload (what we receive from a speaker). */
export interface VoicePayloadS2C {
    voiceCounter: number;
    /** The originating client id (clid) the frame belongs to. */
    senderClientId: number;
    codec: Codec;
    frame: Buffer;
}

/**
 * An empty codec frame is TS3's end-of-talk marker: the sender emits a few voice
 * packets with no codec bytes so the receiver flushes its jitter buffer and stops
 * playback (`../PROTOCOL.md` §6.4).
 */
export function isTalkStopFrame(frame: Buffer): boolean {
    return frame.length === 0;
}

/** Serialize a client→server voice payload: `voiceCounter(2) codec(1) frame`. */
export function encodeVoiceC2S(voiceCounter: number, codec: Codec, frame: Buffer): Buffer {
    const out: Buffer = Buffer.alloc(VOICE_HEADER_C2S + frame.length);
    out.writeUInt16BE(voiceCounter & 0xffff, 0);
    out.writeUInt8(codec & 0xff, 2);
    frame.copy(out, VOICE_HEADER_C2S);
    return out;
}

/** Parse a client→server voice payload. `frame` is a view onto `data` (no copy). */
export function decodeVoiceC2S(data: Buffer): VoicePayloadC2S {
    if (data.length < VOICE_HEADER_C2S) {
        throw new Error(
            `VoicePacket: C2S payload too short (${data.length} < ${VOICE_HEADER_C2S})`,
        );
    }
    return {
        voiceCounter: data.readUInt16BE(0),
        codec: data.readUInt8(2) as Codec,
        frame: data.subarray(VOICE_HEADER_C2S),
    };
}

/** Serialize a server→client voice payload: `voiceCounter(2) senderId(2) codec(1) frame`. */
export function encodeVoiceS2C(
    voiceCounter: number,
    senderClientId: number,
    codec: Codec,
    frame: Buffer,
): Buffer {
    const out: Buffer = Buffer.alloc(VOICE_HEADER_S2C + frame.length);
    out.writeUInt16BE(voiceCounter & 0xffff, 0);
    out.writeUInt16BE(senderClientId & 0xffff, 2);
    out.writeUInt8(codec & 0xff, 4);
    frame.copy(out, VOICE_HEADER_S2C);
    return out;
}

/** Parse a server→client voice payload. `frame` is a view onto `data` (no copy). */
export function decodeVoiceS2C(data: Buffer): VoicePayloadS2C {
    if (data.length < VOICE_HEADER_S2C) {
        throw new Error(
            `VoicePacket: S2C payload too short (${data.length} < ${VOICE_HEADER_S2C})`,
        );
    }
    return {
        voiceCounter: data.readUInt16BE(0),
        senderClientId: data.readUInt16BE(2),
        codec: data.readUInt8(4) as Codec,
        frame: data.subarray(VOICE_HEADER_S2C),
    };
}
