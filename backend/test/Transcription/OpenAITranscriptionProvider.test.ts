import { describe, expect, it } from 'vitest';
import { INTERNAL_AUDIO_FORMAT, type IAudioFrame } from '../../src/Audio/AudioFormat.js';
import { PushAudioSource } from '../../src/Audio/PushAudioSource.js';
import { OpenAITranscriptionProvider } from '../../src/Transcription/OpenAITranscriptionProvider.js';
import type { TranscriptResult } from '../../src/Transcription/ITranscriptionProvider.js';
import { FakeTranscriptionSession } from './FakeTranscriptionSession.js';

function frame(samples: number, value: number = 100): IAudioFrame {
    const buffer: Buffer = Buffer.alloc(samples * INTERNAL_AUDIO_FORMAT.bytesPerSample);
    for (let i: number = 0; i < samples; i++) {
        buffer.writeInt16LE(value, i * INTERNAL_AUDIO_FORMAT.bytesPerSample);
    }
    return {
        data: buffer,
        timestamp: 1,
        sampleRate: INTERNAL_AUDIO_FORMAT.sampleRate,
        channels: INTERNAL_AUDIO_FORMAT.channels,
    };
}

describe('OpenAITranscriptionProvider', () => {
    it('opens a session, feeds resampled audio and maps partial/final results', async () => {
        const created: FakeTranscriptionSession[] = [];
        const provider: OpenAITranscriptionProvider = new OpenAITranscriptionProvider(() => {
            const s: FakeTranscriptionSession = new FakeTranscriptionSession(24000);
            created.push(s);
            return s;
        });
        const source: PushAudioSource = new PushAudioSource('spk');
        const results: TranscriptResult[] = [];

        await provider.start('spk', source, (r: TranscriptResult): void => {
            results.push(r);
        });
        expect(created).toHaveLength(1);
        expect(created[0]!.opened).toBe(true);

        source.push(frame(320)); // 20 ms @ 16 kHz
        expect(created[0]!.sent).toHaveLength(1);
        // 320 samples @ 16 kHz → 24 kHz = 480 samples = 960 bytes.
        expect(created[0]!.sent[0]!.length).toBe(960);

        created[0]!.emitPartial('hel');
        created[0]!.emitFinal('hello');
        expect(
            results.map((r) => ({ text: r.text, final: r.final, speakerId: r.speakerId })),
        ).toEqual([
            { text: 'hel', final: false, speakerId: 'spk' },
            { text: 'hello', final: true, speakerId: 'spk' },
        ]);
        expect(typeof results[0]!.timestamp).toBe('number');
    });

    it('does not resample when the session already runs at the internal rate', async () => {
        const created: FakeTranscriptionSession[] = [];
        const provider: OpenAITranscriptionProvider = new OpenAITranscriptionProvider(() => {
            const s: FakeTranscriptionSession = new FakeTranscriptionSession(
                INTERNAL_AUDIO_FORMAT.sampleRate,
            );
            created.push(s);
            return s;
        });
        const source: PushAudioSource = new PushAudioSource('spk');
        await provider.start('spk', source, (): void => {});

        source.push(frame(320));
        expect(created[0]!.sent[0]!.length).toBe(640); // unchanged: 320 * 2 bytes
    });

    it('stops feeding and closes the session on stop', async () => {
        const created: FakeTranscriptionSession[] = [];
        const provider: OpenAITranscriptionProvider = new OpenAITranscriptionProvider(() => {
            const s: FakeTranscriptionSession = new FakeTranscriptionSession(24000);
            created.push(s);
            return s;
        });
        const source: PushAudioSource = new PushAudioSource('spk');
        await provider.start('spk', source, (): void => {});
        source.push(frame(320));
        await provider.stop('spk');

        expect(created[0]!.closed).toBe(true);
        source.push(frame(320)); // no longer subscribed
        expect(created[0]!.sent).toHaveLength(1);
    });

    it('ignores a duplicate start for the same speaker', async () => {
        const created: FakeTranscriptionSession[] = [];
        const provider: OpenAITranscriptionProvider = new OpenAITranscriptionProvider(() => {
            const s: FakeTranscriptionSession = new FakeTranscriptionSession();
            created.push(s);
            return s;
        });
        const source: PushAudioSource = new PushAudioSource('spk');
        await provider.start('spk', source, (): void => {});
        await provider.start('spk', source, (): void => {});
        expect(created).toHaveLength(1);
    });
});
