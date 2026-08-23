import { describe, expect, it } from 'vitest';
import { WAV_HEADER_BYTES, encodeWav } from '../../src/Audio/WavEncoder.js';

describe('encodeWav', () => {
    it('prepends a canonical 44-byte PCM WAV header', () => {
        const pcm: Buffer = Buffer.alloc(160); // 80 samples mono s16le
        const wav: Buffer = encodeWav(pcm, { sampleRate: 16000, channels: 1, bitsPerSample: 16 });

        expect(wav.length).toBe(WAV_HEADER_BYTES + pcm.length);
        expect(wav.toString('ascii', 0, 4)).toBe('RIFF');
        expect(wav.readUInt32LE(4)).toBe(36 + pcm.length);
        expect(wav.toString('ascii', 8, 12)).toBe('WAVE');
        expect(wav.toString('ascii', 12, 16)).toBe('fmt ');
        expect(wav.readUInt16LE(20)).toBe(1); // PCM
        expect(wav.readUInt16LE(22)).toBe(1); // channels
        expect(wav.readUInt32LE(24)).toBe(16000); // sample rate
        expect(wav.readUInt32LE(28)).toBe(16000 * 2); // byte rate = rate * blockAlign
        expect(wav.readUInt16LE(32)).toBe(2); // block align
        expect(wav.readUInt16LE(34)).toBe(16); // bits per sample
        expect(wav.toString('ascii', 36, 40)).toBe('data');
        expect(wav.readUInt32LE(40)).toBe(pcm.length);
    });

    it('carries the sample data verbatim after the header', () => {
        const pcm: Buffer = Buffer.from([1, 2, 3, 4, 5, 6]);
        const wav: Buffer = encodeWav(pcm, { sampleRate: 24000, channels: 1, bitsPerSample: 16 });
        expect(Buffer.compare(wav.subarray(WAV_HEADER_BYTES), pcm)).toBe(0);
    });
});
