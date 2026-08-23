import { describe, expect, it } from 'vitest';
import { DiscordOpusCodecFactory } from '../../../../src/Platform/Adapters/TeamSpeak/protocol/voice/DiscordOpusCodec.js';
import {
    OPUS_VOICE,
    type IOpusDecoder,
    type IOpusEncoder,
} from '../../../../src/Platform/Adapters/TeamSpeak/protocol/voice/IOpusCodec.js';

/**
 * Probe whether the native `@discordjs/opus` prebuild is loadable here. On a build
 * host / CI without the native binary these tests skip instead of failing — the
 * pure voice-layer tests still cover the protocol, and the codec is behind a seam.
 */
function opusAvailable(): boolean {
    try {
        new DiscordOpusCodecFactory().createEncoder(OPUS_VOICE).close();
        return true;
    } catch {
        return false;
    }
}

const available: boolean = opusAvailable();

describe.skipIf(!available)('DiscordOpusCodec (native @discordjs/opus)', () => {
    const factory: DiscordOpusCodecFactory = new DiscordOpusCodecFactory();
    const frameSamples: number = OPUS_VOICE.frameSize * OPUS_VOICE.channels;

    it('round-trips a 20 ms voice frame to Opus and back to the right length', () => {
        const encoder: IOpusEncoder = factory.createEncoder(OPUS_VOICE);
        const decoder: IOpusDecoder = factory.createDecoder(OPUS_VOICE);
        // A quiet sine-ish ramp so it is not pure silence.
        const pcm: Int16Array = new Int16Array(frameSamples);
        for (let i: number = 0; i < pcm.length; i++) {
            pcm[i] = ((i * 32) % 4000) - 2000;
        }
        const opus: Buffer = encoder.encode(pcm);
        expect(opus.length).toBeGreaterThan(0);
        const decoded: Int16Array = decoder.decode(opus);
        expect(decoded.length).toBe(frameSamples);
        encoder.close();
        decoder.close();
    });

    it('rejects a frame with the wrong sample count', () => {
        const encoder: IOpusEncoder = factory.createEncoder(OPUS_VOICE);
        expect(() => encoder.encode(new Int16Array(frameSamples - 1))).toThrow(/expected/);
        encoder.close();
    });

    it('conceals a lost/empty frame as one frame of silence', () => {
        const decoder: IOpusDecoder = factory.createDecoder(OPUS_VOICE);
        const silence: Int16Array = decoder.decode(null);
        expect(silence.length).toBe(frameSamples);
        expect(silence.every((s: number) => s === 0)).toBe(true);
        decoder.close();
    });
});
