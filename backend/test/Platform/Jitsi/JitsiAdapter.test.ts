import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { IAudioFrame } from '../../../src/Audio/AudioFormat.js';
import { INTERNAL_AUDIO_FORMAT } from '../../../src/Audio/AudioFormat.js';
import type { IAudioSource } from '../../../src/Audio/IAudio.js';
import { EventBus } from '../../../src/Core/EventBus.js';
import { AudioMeshEvent } from '../../../src/Core/Events.js';
import { JitsiAdapter } from '../../../src/Platform/Adapters/Jitsi/JitsiAdapter.js';
import { FakeJitsiClient } from './FakeJitsiClient.js';

describe('JitsiAdapter (with FakeJitsiClient)', () => {
    let fake: FakeJitsiClient;
    let adapter: JitsiAdapter;

    beforeEach(() => {
        fake = new FakeJitsiClient([{ id: 'p1', displayName: 'Alice' }]);
        adapter = new JitsiAdapter({ domain: 'meet.example.com' }, () => fake);
    });

    afterEach(async () => {
        await adapter.disconnect();
    });

    it('reports the jitsi kind', () => {
        expect(adapter.kind).toBe('jitsi');
    });

    it('connects and joins a room, muted by default', async () => {
        await adapter.connect();
        expect(adapter.isConnected()).toBe(true);

        const channel = await adapter.joinChannel('DailyStandup');
        expect(channel.id).toBe('DailyStandup');
        expect(fake.joinedRoom).toBe('DailyStandup');
        expect(fake.muted).toBe(true);

        expect(await adapter.getChannels()).toEqual([{ id: 'DailyStandup', name: 'DailyStandup' }]);
        const participants = await adapter.getParticipants();
        expect(participants).toEqual([{ platformUserId: 'p1', displayName: 'Alice' }]);
    });

    it('rejects an empty room name', async () => {
        await adapter.connect();
        await expect(adapter.joinChannel('   ')).rejects.toThrow(/room name/);
    });

    it('tracks participants joining and leaving after join', async () => {
        await adapter.connect();
        await adapter.joinChannel('room');
        fake.emitJoin({ id: 'p2', displayName: 'Bob' });
        expect((await adapter.getParticipants()).map((p) => p.platformUserId)).toEqual([
            'p1',
            'p2',
        ]);
        fake.emitLeft('p1');
        expect((await adapter.getParticipants()).map((p) => p.platformUserId)).toEqual(['p2']);
    });

    it('converts native 48 kHz audio into internal-format frames on the source', async () => {
        await adapter.connect();
        await adapter.joinChannel('room');

        const source: IAudioSource = adapter.receiveAudio('p1');
        const frames: IAudioFrame[] = [];
        source.onFrame((f: IAudioFrame): void => {
            frames.push(f);
        });

        // 1 s of 48 kHz mono -> 16 kHz -> 50 frames of 20 ms.
        fake.emitAudio({
            participantId: 'p1',
            samples: new Int16Array(48000).fill(500),
            sampleRate: 48000,
        });

        expect(frames.length).toBeGreaterThanOrEqual(49);
        expect(frames.length).toBeLessThanOrEqual(50);
        const first = frames[0]!;
        expect(first.sampleRate).toBe(INTERNAL_AUDIO_FORMAT.sampleRate);
        expect(first.channels).toBe(1);
        expect(first.speakerId).toBe('p1');
        expect(first.data.readInt16LE(0)).toBe(500);
    });

    it('closes and flushes a participant source when they leave', async () => {
        await adapter.connect();
        await adapter.joinChannel('room');
        const source = adapter.receiveAudio('p1');
        let closedFrames: number = 0;
        source.onFrame((): void => {
            closedFrames++;
        });
        // A sub-frame amount so the flush path (zero-pad) is exercised.
        fake.emitAudio({
            participantId: 'p1',
            samples: new Int16Array(300).fill(1),
            sampleRate: 48000,
        });
        fake.emitLeft('p1');
        // The flush on leave emits the buffered tail as one final frame.
        expect(closedFrames).toBeGreaterThanOrEqual(1);
    });

    it('surfaces client errors as ErrorOccurred without throwing', async () => {
        const seen: string[] = [];
        const handler = (p: { component: string; message: string }): void => {
            seen.push(`${p.component}:${p.message}`);
        };
        EventBus.getInstance().on(AudioMeshEvent.ErrorOccurred, handler);
        try {
            await adapter.connect();
            fake.emitError('bridge channel closed');
            expect(
                seen.some((s) => s.startsWith('JitsiAdapter:') && s.includes('bridge channel')),
            ).toBe(true);
        } finally {
            EventBus.getInstance().off(AudioMeshEvent.ErrorOccurred, handler);
        }
    });
});
