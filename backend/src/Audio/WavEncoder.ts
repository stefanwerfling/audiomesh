/** PCM shape a WAV wraps. Matches the internal audio format (mono s16le). */
export interface WavFormat {
    sampleRate: number;
    channels: number;
    /** Bits per sample (16 for the internal s16le format). */
    bitsPerSample: number;
}

/** Bytes in a canonical PCM WAV header (RIFF + fmt + data chunk headers). */
export const WAV_HEADER_BYTES: number = 44;

/**
 * Build the 44-byte canonical PCM WAV header for a stream carrying `dataBytes`
 * of raw samples. Shared by {@link WavWriter} (streaming to a file, patched on
 * close) and {@link encodeWav} (whole buffer in memory) so the byte layout lives
 * in one place.
 */
export function wavHeader(dataBytes: number, format: WavFormat): Buffer {
    const { sampleRate, channels, bitsPerSample } = format;
    const blockAlign: number = (channels * bitsPerSample) / 8;
    const byteRate: number = sampleRate * blockAlign;
    const header: Buffer = Buffer.alloc(WAV_HEADER_BYTES);
    header.write('RIFF', 0, 'ascii');
    header.writeUInt32LE(36 + dataBytes, 4);
    header.write('WAVE', 8, 'ascii');
    header.write('fmt ', 12, 'ascii');
    header.writeUInt32LE(16, 16); // PCM fmt chunk size
    header.writeUInt16LE(1, 20); // audio format = PCM
    header.writeUInt16LE(channels, 22);
    header.writeUInt32LE(sampleRate, 24);
    header.writeUInt32LE(byteRate, 28);
    header.writeUInt16LE(blockAlign, 32);
    header.writeUInt16LE(bitsPerSample, 34);
    header.write('data', 36, 'ascii');
    header.writeUInt32LE(dataBytes, 40);
    return header;
}

/**
 * Encode raw PCM (already in `format`) into a complete in-memory WAV buffer —
 * header + data — ready to POST as a file. Used by the batch/segmenting
 * transcription path, which uploads short speech segments to
 * `/v1/audio/transcriptions`.
 */
export function encodeWav(pcm: Buffer, format: WavFormat): Buffer {
    return Buffer.concat([wavHeader(pcm.length, format), pcm]);
}
