import { Buffer } from 'node:buffer';
import { createRequire } from 'node:module';
import type { IOpusCodecFactory, IOpusDecoder, IOpusEncoder, OpusParams } from './IOpusCodec.js';

/**
 * {@link IOpusCodecFactory} backed by **`@discordjs/opus`** — the native (N-API)
 * libopus binding used by the Discord voice stack, chosen for TS3 voice for its
 * encode/decode speed and shipped prebuilds. It is the protocol stack's first and
 * only native dependency; everything else stays pure so unit tests fake this seam.
 *
 * `@discordjs/opus` is CommonJS and native, so it is loaded **lazily** via
 * `createRequire`: importing this file never triggers the native binding (the pure
 * voice tests inject a fake and never touch it), and a missing prebuild surfaces as
 * a clear error when the client first creates a codec — not at module import.
 *
 * A single native `OpusEncoder` object does both directions (`encode`/`decode`), so
 * the encoder and decoder each own their own instance. PCM crosses the boundary as
 * interleaved Int16 in host byte order (little-endian on the platforms we target),
 * which is what `@discordjs/opus` expects.
 */

/** The subset of the native `OpusEncoder` we use. */
interface OpusEncoderNative {
    encode(pcm: Buffer): Buffer;
    decode(data: Buffer): Buffer;
    setBitrate(bitrate: number): void;
}

interface OpusModule {
    OpusEncoder: new (sampleRate: number, channels: number) => OpusEncoderNative;
}

const requireOpus: NodeRequire = createRequire(import.meta.url);
let cachedModule: OpusModule | null = null;

/** Lazily load (and cache) the native module; throws clearly if the prebuild is absent. */
function loadOpus(): OpusModule {
    if (cachedModule === null) {
        cachedModule = requireOpus('@discordjs/opus') as OpusModule;
    }
    return cachedModule;
}

class DiscordOpusEncoder implements IOpusEncoder {
    private readonly _native: OpusEncoderNative;
    private readonly _expectedSamples: number;

    public constructor(params: OpusParams) {
        this._native = new (loadOpus().OpusEncoder)(params.sampleRate, params.channels);
        this._native.setBitrate(params.bitrate);
        this._expectedSamples = params.frameSize * params.channels;
    }

    public encode(pcm: Int16Array): Buffer {
        if (pcm.length !== this._expectedSamples) {
            throw new Error(
                `DiscordOpusEncoder: expected ${this._expectedSamples} samples, got ${pcm.length}`,
            );
        }
        return this._native.encode(Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength));
    }

    public close(): void {
        // The native object has no explicit free; GC reclaims it.
    }
}

class DiscordOpusDecoder implements IOpusDecoder {
    private readonly _native: OpusEncoderNative;
    private readonly _frameSamples: number;

    public constructor(params: OpusParams) {
        this._native = new (loadOpus().OpusEncoder)(params.sampleRate, params.channels);
        this._frameSamples = params.frameSize * params.channels;
    }

    public decode(frame: Buffer | null): Int16Array {
        if (frame === null || frame.length === 0) {
            // Packet loss / talk-stop: emit one frame of silence.
            return new Int16Array(this._frameSamples);
        }
        const pcm: Buffer = this._native.decode(frame);
        // Copy out of the native buffer (slice) so we never alias its memory.
        return new Int16Array(pcm.buffer, pcm.byteOffset, pcm.byteLength >>> 1).slice();
    }

    public close(): void {
        // The native object has no explicit free; GC reclaims it.
    }
}

export class DiscordOpusCodecFactory implements IOpusCodecFactory {
    public createEncoder(params: OpusParams): IOpusEncoder {
        return new DiscordOpusEncoder(params);
    }

    public createDecoder(params: OpusParams): IOpusDecoder {
        return new DiscordOpusDecoder(params);
    }
}
