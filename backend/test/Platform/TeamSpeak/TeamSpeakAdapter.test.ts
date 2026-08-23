import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { IAudioFrame } from '../../../src/Audio/AudioFormat.js';
import { INTERNAL_AUDIO_FORMAT } from '../../../src/Audio/AudioFormat.js';
import type { IAudioSource } from '../../../src/Audio/IAudio.js';
import { EventBus } from '../../../src/Core/EventBus.js';
import { AudioMeshEvent } from '../../../src/Core/Events.js';
import type { IAdapterEventListener } from '../../../src/Platform/IVoicePlatformAdapter.js';
import { TeamSpeakAdapter } from '../../../src/Platform/Adapters/TeamSpeak/TeamSpeakAdapter.js';
import { FakeTeamSpeakClient } from './FakeTeamSpeakClient.js';

describe('TeamSpeakAdapter (with FakeTeamSpeakClient)', () => {
    let fake: FakeTeamSpeakClient;
    let adapter: TeamSpeakAdapter;

    beforeEach(() => {
        fake = new FakeTeamSpeakClient(
            [{ id: 'c1', displayName: 'Alice' }],
            [
                { id: '1', name: 'Lobby' },
                { id: '2', name: 'Meeting' },
            ],
        );
        adapter = new TeamSpeakAdapter({ host: 'ts.example.com' }, () => fake);
    });

    afterEach(async () => {
        await adapter.disconnect();
    });

    it('reports the teamspeak kind', () => {
        expect(adapter.kind).toBe('teamspeak');
    });

    it('connects and joins a channel, muted by default', async () => {
        await adapter.connect();
        expect(adapter.isConnected()).toBe(true);

        const channel = await adapter.joinChannel('2');
        expect(channel).toEqual({ id: '2', name: 'Meeting' });
        expect(fake.joinedChannel).toBe('2');
        expect(fake.muted).toBe(true);

        const participants = await adapter.getParticipants();
        expect(participants).toEqual([{ platformUserId: 'c1', displayName: 'Alice' }]);
    });

    it('enumerates the server channel directory', async () => {
        await adapter.connect();
        expect(await adapter.getChannels()).toEqual([
            { id: '1', name: 'Lobby' },
            { id: '2', name: 'Meeting' },
        ]);
    });

    it('auto-joins the configured default channel on connect', async () => {
        const withDefault = new TeamSpeakAdapter(
            { host: 'ts.example.com', defaultChannelId: '1' },
            () => fake,
        );
        await withDefault.connect();
        expect(fake.joinedChannel).toBe('1');
        await withDefault.disconnect();
    });

    it('rejects an empty channel id', async () => {
        await adapter.connect();
        await expect(adapter.joinChannel('   ')).rejects.toThrow(/channelId/);
    });

    it('tracks participants joining and leaving', async () => {
        await adapter.connect();
        await adapter.joinChannel('2');
        fake.emitJoin({ id: 'c2', displayName: 'Bob' });
        expect((await adapter.getParticipants()).map((p) => p.platformUserId)).toEqual([
            'c1',
            'c2',
        ]);
        fake.emitLeft('c1');
        expect((await adapter.getParticipants()).map((p) => p.platformUserId)).toEqual(['c2']);
    });

    it('maps per-client talk status onto speaking events', async () => {
        const speaking: { id: string; on: boolean }[] = [];
        const listener: IAdapterEventListener = {
            onParticipantJoined: (): void => {},
            onParticipantLeft: (): void => {},
            onSpeakingChanged: (id: string, on: boolean): void => {
                speaking.push({ id: id, on: on });
            },
        };
        adapter.setEventListener(listener);
        await adapter.connect();
        fake.emitSpeaking('c1', true);
        fake.emitSpeaking('c1', false);
        expect(speaking).toEqual([
            { id: 'c1', on: true },
            { id: 'c1', on: false },
        ]);
    });

    it('converts native 48 kHz audio into internal-format frames on the source', async () => {
        await adapter.connect();
        await adapter.joinChannel('2');

        const source: IAudioSource = adapter.receiveAudio('c1');
        const frames: IAudioFrame[] = [];
        source.onFrame((f: IAudioFrame): void => {
            frames.push(f);
        });

        // 1 s of 48 kHz mono -> 16 kHz -> 50 frames of 20 ms.
        fake.emitAudio({
            participantId: 'c1',
            samples: new Int16Array(48000).fill(500),
            sampleRate: 48000,
        });

        expect(frames.length).toBeGreaterThanOrEqual(49);
        expect(frames.length).toBeLessThanOrEqual(50);
        const first = frames[0]!;
        expect(first.sampleRate).toBe(INTERNAL_AUDIO_FORMAT.sampleRate);
        expect(first.channels).toBe(1);
        expect(first.speakerId).toBe('c1');
        expect(first.data.readInt16LE(0)).toBe(500);
    });

    it('surfaces client errors as ErrorOccurred without throwing', async () => {
        const seen: string[] = [];
        const handler = (p: { component: string; message: string }): void => {
            seen.push(`${p.component}:${p.message}`);
        };
        EventBus.getInstance().on(AudioMeshEvent.ErrorOccurred, handler);
        try {
            await adapter.connect();
            fake.emitError('udp socket closed');
            expect(
                seen.some((s) => s.startsWith('TeamSpeakAdapter:') && s.includes('udp socket')),
            ).toBe(true);
        } finally {
            EventBus.getInstance().off(AudioMeshEvent.ErrorOccurred, handler);
        }
    });
});
