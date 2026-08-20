import { INTERNAL_AUDIO_FORMAT } from './AudioFormat.js';

/**
 * Read a little-endian s16 PCM {@link Buffer} as an {@link Int16Array}. A plain
 * `new Int16Array(buf.buffer, ...)` view is avoided on purpose: Node `Buffer`s
 * are slices into a shared pool, so the underlying `ArrayBuffer` may be larger,
 * offset and mutated elsewhere. Copying per sample yields an independent,
 * correctly-aligned array the caller can safely retain.
 */
export function int16FromPcmBuffer(buffer: Buffer): Int16Array {
    const count: number = Math.floor(buffer.length / INTERNAL_AUDIO_FORMAT.bytesPerSample);
    const out: Int16Array = new Int16Array(count);
    for (let i: number = 0; i < count; i++) {
        out[i] = buffer.readInt16LE(i * INTERNAL_AUDIO_FORMAT.bytesPerSample);
    }
    return out;
}

/** Serialise Int16 PCM samples back into a little-endian s16 {@link Buffer}. */
export function pcmBufferFromInt16(samples: Int16Array): Buffer {
    const buffer: Buffer = Buffer.alloc(samples.length * INTERNAL_AUDIO_FORMAT.bytesPerSample);
    for (let i: number = 0; i < samples.length; i++) {
        buffer.writeInt16LE(samples[i] as number, i * INTERNAL_AUDIO_FORMAT.bytesPerSample);
    }
    return buffer;
}
