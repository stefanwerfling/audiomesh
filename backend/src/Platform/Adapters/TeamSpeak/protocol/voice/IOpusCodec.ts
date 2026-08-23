import type { Buffer } from 'node:buffer';

/**
 * The Opus codec seam for the voice layer. Encoding/decoding Opus needs libopus,
 * which is the protocol stack's **first external dependency** — so, following the
 * same pattern as the OpenAI provider seams (`IRealtimeTranscriptionSession`,
 * `ISpeechSynthesisProvider`) and the Jitsi client seam, the codec sits behind an
 * interface. Layer 9 (`Ts3ProtocolClient`) injects a concrete libopus-backed
 * factory; unit tests inject a fake, so the whole voice path is testable without a
 * native build. This also keeps the native-binding choice (`@discordjs/opus` vs
 * `opusscript` vs `node-opus`) out of the pure protocol layers.
 *
 * Parameters and codec ids are pinned from TSLib `EncoderPipe.cs` — see
 * `../PROTOCOL.md` §6.3. Frames are always 20 ms (960 samples per channel @ 48 kHz),
 * one Opus packet per UDP voice packet.
 */

/** Opus application tuning (maps to libopus `OPUS_APPLICATION_*`). */
export const OpusApplication = {
    Voip: 'voip',
    Audio: 'audio',
} as const;
export type OpusApplication = (typeof OpusApplication)[keyof typeof OpusApplication];

/** Concrete Opus parameters for one stream (`../PROTOCOL.md` §6.3). */
export interface OpusParams {
    /** Sample rate in Hz — always 48000 for TS3 voice. */
    sampleRate: number;
    /** Channel count: 1 (OpusVoice) or 2 (OpusMusic). */
    channels: number;
    application: OpusApplication;
    /** Target bitrate in bits/s. */
    bitrate: number;
    /** Samples per channel per frame (960 = 20 ms @ 48 kHz). */
    frameSize: number;
}

/** OpusVoice (codec id 4): 48 kHz mono, VOIP tuning — what the bot sends/receives. */
export const OPUS_VOICE: OpusParams = {
    sampleRate: 48000,
    channels: 1,
    application: OpusApplication.Voip,
    bitrate: 16384,
    frameSize: 960,
};

/** OpusMusic (codec id 5): 48 kHz stereo, audio tuning. */
export const OPUS_MUSIC: OpusParams = {
    sampleRate: 48000,
    channels: 2,
    application: OpusApplication.Audio,
    bitrate: 32768,
    frameSize: 960,
};

/** Encodes interleaved Int16 PCM frames to Opus. Stateful (keeps encoder context). */
export interface IOpusEncoder {
    /**
     * Encode exactly `frameSize * channels` Int16 samples into one Opus frame.
     * Implementations may throw on a wrong-length input.
     */
    encode(pcm: Int16Array): Buffer;
    /** Release native resources, if any. */
    close(): void;
}

/** Decodes Opus frames to interleaved Int16 PCM. Stateful (keeps decoder context). */
export interface IOpusDecoder {
    /**
     * Decode one Opus frame to `frameSize * channels` Int16 samples. Pass `null`
     * to run packet-loss concealment for a dropped frame (libopus decodes silence /
     * an interpolation when handed no data).
     */
    decode(frame: Buffer | null): Int16Array;
    /** Release native resources, if any. */
    close(): void;
}

/** Creates encoders/decoders for given {@link OpusParams} — the injectable seam. */
export interface IOpusCodecFactory {
    createEncoder(params: OpusParams): IOpusEncoder;
    createDecoder(params: OpusParams): IOpusDecoder;
}
