import { describe, expect, it } from 'vitest';
import type {
    IAdapterEventListener,
    IParticipantInfo,
} from '../../../src/Platform/IVoicePlatformAdapter.js';
import { JitsiAdapter } from '../../../src/Platform/Adapters/Jitsi/JitsiAdapter.js';
import { FakeJitsiClient } from './FakeJitsiClient.js';

interface SpeakEvent {
    id: string;
    speaking: boolean;
}

function recordingListener(): {
    listener: IAdapterEventListener;
    joined: IParticipantInfo[];
    left: string[];
    speaking: SpeakEvent[];
} {
    const joined: IParticipantInfo[] = [];
    const left: string[] = [];
    const speaking: SpeakEvent[] = [];
    return {
        joined: joined,
        left: left,
        speaking: speaking,
        listener: {
            onParticipantJoined: (info: IParticipantInfo): void => {
                joined.push(info);
            },
            onParticipantLeft: (id: string): void => {
                left.push(id);
            },
            onSpeakingChanged: (id: string, isSpeaking: boolean): void => {
                speaking.push({ id: id, speaking: isSpeaking });
            },
        },
    };
}

describe('JitsiAdapter event listener', () => {
    it('forwards participant join and leave to the listener', async () => {
        const fake: FakeJitsiClient = new FakeJitsiClient();
        const adapter: JitsiAdapter = new JitsiAdapter({ domain: 'meet.example.com' }, () => fake);
        const rec = recordingListener();
        adapter.setEventListener(rec.listener);
        await adapter.connect();
        await adapter.joinChannel('room');

        fake.emitJoin({ id: 'p1', displayName: 'Alice' });
        fake.emitLeft('p1');

        expect(rec.joined).toEqual([{ platformUserId: 'p1', displayName: 'Alice' }]);
        expect(rec.left).toEqual(['p1']);
    });

    it('maps dominant-speaker changes to per-participant speaking transitions', async () => {
        const fake: FakeJitsiClient = new FakeJitsiClient();
        const adapter: JitsiAdapter = new JitsiAdapter({ domain: 'meet.example.com' }, () => fake);
        const rec = recordingListener();
        adapter.setEventListener(rec.listener);
        await adapter.connect();
        await adapter.joinChannel('room');

        fake.emitDominantSpeaker('a'); // a starts
        fake.emitDominantSpeaker('b'); // a stops, b starts
        fake.emitDominantSpeaker(null); // b stops

        expect(rec.speaking).toEqual([
            { id: 'a', speaking: true },
            { id: 'a', speaking: false },
            { id: 'b', speaking: true },
            { id: 'b', speaking: false },
        ]);
    });

    it('ignores a repeated dominant-speaker signal (no duplicate events)', async () => {
        const fake: FakeJitsiClient = new FakeJitsiClient();
        const adapter: JitsiAdapter = new JitsiAdapter({ domain: 'meet.example.com' }, () => fake);
        const rec = recordingListener();
        adapter.setEventListener(rec.listener);
        await adapter.connect();

        fake.emitDominantSpeaker('a');
        fake.emitDominantSpeaker('a');
        expect(rec.speaking).toEqual([{ id: 'a', speaking: true }]);
    });

    it('marks the dominant speaker silent when they leave', async () => {
        const fake: FakeJitsiClient = new FakeJitsiClient();
        const adapter: JitsiAdapter = new JitsiAdapter({ domain: 'meet.example.com' }, () => fake);
        const rec = recordingListener();
        adapter.setEventListener(rec.listener);
        await adapter.connect();
        await adapter.joinChannel('room');

        fake.emitDominantSpeaker('a');
        fake.emitLeft('a');

        expect(rec.speaking).toEqual([
            { id: 'a', speaking: true },
            { id: 'a', speaking: false },
        ]);
        expect(rec.left).toEqual(['a']);
    });
});
