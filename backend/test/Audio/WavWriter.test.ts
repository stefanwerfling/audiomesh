import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { WavWriter } from '../../src/Audio/WavWriter.js';

describe('WavWriter', () => {
    let dir: string;

    beforeEach(() => {
        dir = mkdtempSync(join(tmpdir(), 'audiomesh-wav-'));
    });

    it('writes a valid 44-byte PCM header with backfilled sizes', () => {
        const file: string = join(dir, 'a.wav');
        const writer: WavWriter = new WavWriter(file, {
            sampleRate: 16000,
            channels: 1,
            bitsPerSample: 16,
        });
        writer.write(Buffer.alloc(640, 1)); // 320 samples
        writer.write(Buffer.alloc(640, 2));
        writer.close();

        const buf: Buffer = readFileSync(file);
        expect(buf.subarray(0, 4).toString('ascii')).toBe('RIFF');
        expect(buf.subarray(8, 12).toString('ascii')).toBe('WAVE');
        expect(buf.subarray(36, 40).toString('ascii')).toBe('data');
        expect(buf.readUInt16LE(20)).toBe(1); // PCM
        expect(buf.readUInt16LE(22)).toBe(1); // mono
        expect(buf.readUInt32LE(24)).toBe(16000); // sample rate
        expect(buf.readUInt32LE(28)).toBe(32000); // byte rate = 16000*2
        expect(buf.readUInt16LE(34)).toBe(16); // bits per sample

        const dataBytes: number = 1280;
        expect(buf.readUInt32LE(40)).toBe(dataBytes); // data chunk size
        expect(buf.readUInt32LE(4)).toBe(36 + dataBytes); // RIFF size
        expect(buf.length).toBe(44 + dataBytes);
        expect(writer.bytesWritten).toBe(dataBytes);
        // Payload survived intact.
        expect(buf.readUInt8(44)).toBe(1);
        expect(buf.readUInt8(44 + 640)).toBe(2);
    });

    it('does not create a file when nothing is written (lazy open)', () => {
        const file: string = join(dir, 'empty.wav');
        const writer: WavWriter = new WavWriter(file, {
            sampleRate: 16000,
            channels: 1,
            bitsPerSample: 16,
        });
        writer.close();
        expect(existsSync(file)).toBe(false);
    });

    it('ignores writes after close', () => {
        const file: string = join(dir, 'b.wav');
        const writer: WavWriter = new WavWriter(file, {
            sampleRate: 16000,
            channels: 1,
            bitsPerSample: 16,
        });
        writer.write(Buffer.alloc(640, 7));
        writer.close();
        writer.write(Buffer.alloc(640, 9)); // no-op
        expect(readFileSync(file).length).toBe(44 + 640);
    });
});
