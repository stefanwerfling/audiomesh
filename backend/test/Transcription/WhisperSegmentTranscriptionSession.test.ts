import { describe, expect, it } from 'vitest';
import {
    WhisperSegmentTranscriptionSession,
    type SegmentTranscriber,
} from '../../src/Transcription/WhisperSegmentTranscriptionSession.js';

/** Build a mono s16le PCM buffer of `samples` at a constant amplitude. */
function pcm(samples: number, amplitude: number): Buffer {
    const buffer: Buffer = Buffer.alloc(samples * 2);
    for (let i: number = 0; i < samples; i++) {
        buffer.writeInt16LE(amplitude, i * 2);
    }
    return buffer;
}

const speech = (samples: number): Buffer => pcm(samples, 6000);
const silence = (samples: number): Buffer => pcm(samples, 0);

interface Harness {
    session: WhisperSegmentTranscriptionSession;
    finals: Array<{ text: string; startedAt?: number }>;
    calls: { count: number; maxConcurrent: number };
}

function harness(): Harness {
    const calls: { count: number; maxConcurrent: number } = { count: 0, maxConcurrent: 0 };
    let active: number = 0;
    const transcribe: SegmentTranscriber = async (): Promise<string> => {
        active++;
        calls.maxConcurrent = Math.max(calls.maxConcurrent, active);
        calls.count++;
        const label: string = `seg${calls.count}`;
        await Promise.resolve();
        active--;
        return label;
    };
    const finals: Array<{ text: string; startedAt?: number }> = [];
    const session: WhisperSegmentTranscriptionSession = new WhisperSegmentTranscriptionSession(
        transcribe,
    );
    return { session, finals, calls };
}

async function open(h: Harness): Promise<void> {
    await h.session.open({
        onPartial: (): void => {},
        onFinal: (text: string, startedAt?: number): void =>
            h.finals.push({ text: text, startedAt: startedAt }),
        onError: (): void => {},
    });
}

describe('WhisperSegmentTranscriptionSession', () => {
    it('runs at the internal 16 kHz rate (no resample in the provider)', () => {
        expect(new WhisperSegmentTranscriptionSession(async () => '').inputSampleRate).toBe(16000);
    });

    it('cuts a segment on a pause and stamps it with the utterance start time', async () => {
        const h: Harness = harness();
        await open(h);
        h.session.sendAudio(speech(8000), 1000); // 500 ms of speech
        h.session.sendAudio(silence(12000), 2000); // 750 ms silence > pause → cut
        await h.session.close();

        expect(h.calls.count).toBe(1);
        expect(h.finals).toEqual([{ text: 'seg1', startedAt: 1000 }]);
    });

    it('processes multiple utterances serially and in spoken (FIFO) order', async () => {
        const h: Harness = harness();
        await open(h);
        h.session.sendAudio(speech(8000), 1000);
        h.session.sendAudio(silence(12000), 2000); // cut #1
        h.session.sendAudio(speech(8000), 5000);
        h.session.sendAudio(silence(12000), 6000); // cut #2
        await h.session.close();

        expect(h.finals).toEqual([
            { text: 'seg1', startedAt: 1000 },
            { text: 'seg2', startedAt: 5000 },
        ]);
        expect(h.calls.maxConcurrent).toBe(1); // never two requests at once
    });

    it('drops an utterance shorter than the minimum speech length', async () => {
        const h: Harness = harness();
        await open(h);
        h.session.sendAudio(speech(2000), 1000); // 125 ms < 300 ms minimum
        h.session.sendAudio(silence(12000), 2000);
        await h.session.close();

        expect(h.calls.count).toBe(0);
        expect(h.finals).toEqual([]);
    });

    it('force-cuts a very long utterance even without a pause', async () => {
        const h: Harness = harness();
        await open(h);
        h.session.sendAudio(speech(330000), 1000); // > 20 s → forced cut
        await h.session.close();

        expect(h.calls.count).toBe(1);
        expect(h.finals).toEqual([{ text: 'seg1', startedAt: 1000 }]);
    });

    it('flushes a trailing utterance on close', async () => {
        const h: Harness = harness();
        await open(h);
        h.session.sendAudio(speech(8000), 1000); // no pause; only close flushes it
        await h.session.close();

        expect(h.finals).toEqual([{ text: 'seg1', startedAt: 1000 }]);
    });

    it('ignores audio sent after close', async () => {
        const h: Harness = harness();
        await open(h);
        await h.session.close();
        h.session.sendAudio(speech(8000), 1000);
        expect(h.calls.count).toBe(0);
    });
});
