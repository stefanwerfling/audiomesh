import { closeSync, openSync, writeSync } from 'node:fs';

/** PCM shape a {@link WavWriter} serialises. Matches the internal audio format. */
export interface WavFormat {
    sampleRate: number;
    channels: number;
    /** Bits per sample (16 for the internal s16le format). */
    bitsPerSample: number;
}

const HEADER_BYTES: number = 44;

/**
 * Minimal streaming writer for a canonical 44-byte-header PCM WAV file. Audio is
 * appended frame by frame as it arrives; the RIFF/data sizes aren't known until
 * the stream ends, so the header is written as a placeholder up front and patched
 * on {@link close}. Opening is lazy — the file is only created once real audio
 * arrives, so a participant who never speaks leaves no empty file behind.
 *
 * Deliberately dependency-free (no wav-encoder): the internal format is fixed
 * mono s16le PCM, which is exactly what a raw WAV wraps, so the header is a few
 * fixed fields.
 */
export class WavWriter {
    private readonly _filePath: string;
    private readonly _format: WavFormat;
    private _fd: number | null = null;
    private _dataBytes: number = 0;
    private _closed: boolean = false;

    public constructor(filePath: string, format: WavFormat) {
        this._filePath = filePath;
        this._format = format;
    }

    /** Append raw PCM (already in {@link WavFormat}); opens the file on first call. */
    public write(pcm: Buffer): void {
        if (this._closed || pcm.length === 0) {
            return;
        }
        if (this._fd === null) {
            this._fd = openSync(this._filePath, 'w');
            // Reserve the header; real sizes are backfilled on close().
            writeSync(this._fd, this._buildHeader(0), 0, HEADER_BYTES, 0);
        }
        writeSync(this._fd, pcm, 0, pcm.length, HEADER_BYTES + this._dataBytes);
        this._dataBytes += pcm.length;
    }

    /** Backfill the header with final sizes and close the file descriptor. */
    public close(): void {
        if (this._closed) {
            return;
        }
        this._closed = true;
        if (this._fd === null) {
            return;
        }
        writeSync(this._fd, this._buildHeader(this._dataBytes), 0, HEADER_BYTES, 0);
        closeSync(this._fd);
        this._fd = null;
    }

    public get bytesWritten(): number {
        return this._dataBytes;
    }

    private _buildHeader(dataBytes: number): Buffer {
        const { sampleRate, channels, bitsPerSample } = this._format;
        const blockAlign: number = (channels * bitsPerSample) / 8;
        const byteRate: number = sampleRate * blockAlign;
        const header: Buffer = Buffer.alloc(HEADER_BYTES);
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
}
