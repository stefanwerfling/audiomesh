import { Buffer } from 'node:buffer';
import { describe, expect, it } from 'vitest';
import {
    Codec,
    decodeVoiceC2S,
    decodeVoiceS2C,
    encodeVoiceC2S,
    encodeVoiceS2C,
    isTalkStopFrame,
    VOICE_HEADER_C2S,
    VOICE_HEADER_S2C,
    type VoicePayloadC2S,
    type VoicePayloadS2C,
} from '../../../../src/Platform/Adapters/TeamSpeak/protocol/voice/VoicePacket.js';

const FRAME: Buffer = Buffer.from([0xde, 0xad, 0xbe, 0xef]);

describe('VoicePacket C2S', () => {
    it('serializes voiceCounter(2 BE) + codec(1) + frame', () => {
        const wire: Buffer = encodeVoiceC2S(0x0102, Codec.OpusVoice, FRAME);
        expect(wire.length).toBe(VOICE_HEADER_C2S + FRAME.length);
        expect(wire[0]).toBe(0x01);
        expect(wire[1]).toBe(0x02);
        expect(wire[2]).toBe(Codec.OpusVoice);
        expect(Buffer.compare(wire.subarray(VOICE_HEADER_C2S), FRAME)).toBe(0);
    });

    it('round-trips', () => {
        const decoded: VoicePayloadC2S = decodeVoiceC2S(
            encodeVoiceC2S(40000, Codec.OpusVoice, FRAME),
        );
        expect(decoded.voiceCounter).toBe(40000);
        expect(decoded.codec).toBe(Codec.OpusVoice);
        expect(Buffer.compare(decoded.frame, FRAME)).toBe(0);
    });

    it('handles an empty (talk-stop) frame', () => {
        const decoded: VoicePayloadC2S = decodeVoiceC2S(
            encodeVoiceC2S(7, Codec.OpusVoice, Buffer.alloc(0)),
        );
        expect(decoded.frame.length).toBe(0);
        expect(isTalkStopFrame(decoded.frame)).toBe(true);
        expect(isTalkStopFrame(FRAME)).toBe(false);
    });

    it('rejects a payload shorter than the header', () => {
        expect(() => decodeVoiceC2S(Buffer.alloc(VOICE_HEADER_C2S - 1))).toThrow(/too short/);
    });
});

describe('VoicePacket S2C', () => {
    it('serializes voiceCounter(2) + senderClientId(2) + codec(1) + frame', () => {
        const wire: Buffer = encodeVoiceS2C(0x1122, 0x00ab, Codec.OpusVoice, FRAME);
        expect(wire.length).toBe(VOICE_HEADER_S2C + FRAME.length);
        expect(wire.readUInt16BE(0)).toBe(0x1122);
        expect(wire.readUInt16BE(2)).toBe(0x00ab);
        expect(wire[4]).toBe(Codec.OpusVoice);
    });

    it('round-trips with the sender id', () => {
        const decoded: VoicePayloadS2C = decodeVoiceS2C(
            encodeVoiceS2C(65535, 512, Codec.OpusMusic, FRAME),
        );
        expect(decoded.voiceCounter).toBe(65535);
        expect(decoded.senderClientId).toBe(512);
        expect(decoded.codec).toBe(Codec.OpusMusic);
        expect(Buffer.compare(decoded.frame, FRAME)).toBe(0);
    });

    it('rejects a payload shorter than the header', () => {
        expect(() => decodeVoiceS2C(Buffer.alloc(VOICE_HEADER_S2C - 1))).toThrow(/too short/);
    });
});
