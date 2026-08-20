import { describe, expect, it } from 'vitest';
import { INTERNAL_AUDIO_FORMAT, type IAudioFrame } from '../../../src/Audio/AudioFormat.js';
import type { IAudioSink } from '../../../src/Audio/IAudio.js';
import { JitsiAdapter } from '../../../src/Platform/Adapters/Jitsi/JitsiAdapter.js';
import { FakeJitsiClient } from './FakeJitsiClient.js';

/** Build one internal-format (16 kHz s16le mono) frame of `n` samples at value `v`. */
function frame(n: number, v: number = 1000): IAudioFrame {
    const buffer: Buffer = Buffer.alloc(n * INTERNAL_AUDIO_FORMAT.bytesPerSample);
    for (let i: number = 0; i < n; i++) {
        buffer.writeInt16LE(v, i * INTERNAL_AUDIO_FORMAT.bytesPerSample);
    }
    return {
        data: buffer,
        timestamp: 1000,
        sampleRate: INTERNAL_AUDIO_FORMAT.sampleRate,
        channels: INTERNAL_AUDIO_FORMAT.channels,
    };
}

describe('JitsiAdapter talkback + mute', () => {
    it('is muted by default (startMuted) and drops outbound audio', async () => {
        const fake: FakeJitsiClient = new FakeJitsiClient();
        const adapter: JitsiAdapter = new JitsiAdapter({ domain: 'meet.example.com' }, () => fake);
        expect(adapter.isMuted()).toBe(true);

        const sink: IAudioSink = adapter.sendAudio();
        sink.write(frame(1600)); // 100 ms
        expect(fake.sent).toHaveLength(0);
    });

    it('forwards upsampled 48 kHz chunks when unmuted', async () => {
        const fake: FakeJitsiClient = new FakeJitsiClient([], 48000);
        const adapter: JitsiAdapter = new JitsiAdapter(
            { domain: 'meet.example.com', startMuted: false },
            () => fake,
        );
        expect(adapter.isMuted()).toBe(false);

        // 100 ms @ 16 kHz -> ~300 ms? no: 1600 samples @16k -> 4800 @48k -> 10x 480.
        adapter.sendAudio().write(frame(1600));

        expect(fake.sent.length).toBeGreaterThanOrEqual(9);
        expect(fake.sent.length).toBeLessThanOrEqual(10);
        for (const chunk of fake.sent) {
            expect(chunk.sampleRate).toBe(48000);
            expect(chunk.samples.length).toBe(480); // 10 ms @ 48 kHz
        }
        // A constant input stays constant through upsampling.
        expect(fake.sent[0]!.samples[0]).toBe(1000);
    });

    it('mute()/unmute() flip both adapter state and the client', async () => {
        const fake: FakeJitsiClient = new FakeJitsiClient([], 48000);
        const adapter: JitsiAdapter = new JitsiAdapter(
            { domain: 'meet.example.com', startMuted: false },
            () => fake,
        );
        const sink: IAudioSink = adapter.sendAudio();

        await adapter.mute();
        expect(adapter.isMuted()).toBe(true);
        expect(fake.muted).toBe(true);
        sink.write(frame(1600));
        expect(fake.sent).toHaveLength(0);

        await adapter.unmute();
        expect(adapter.isMuted()).toBe(false);
        expect(fake.muted).toBe(false);
        sink.write(frame(1600));
        expect(fake.sent.length).toBeGreaterThan(0);
    });

    it('sendAudio() returns a stable sink instance', () => {
        const fake: FakeJitsiClient = new FakeJitsiClient();
        const adapter: JitsiAdapter = new JitsiAdapter({ domain: 'meet.example.com' }, () => fake);
        expect(adapter.sendAudio()).toBe(adapter.sendAudio());
    });
});
