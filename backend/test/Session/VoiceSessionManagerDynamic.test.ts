import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Platform } from '@audiomesh/schemas';
import { EventBus } from '../../src/Core/EventBus.js';
import { AudioMeshEvent } from '../../src/Core/Events.js';
import { JitsiAdapter } from '../../src/Platform/Adapters/Jitsi/JitsiAdapter.js';
import { PlatformRegistry } from '../../src/Platform/PlatformRegistry.js';
import type { AdapterConfig } from '../../src/Platform/IVoicePlatformAdapter.js';
import { VoiceSessionManager } from '../../src/Session/VoiceSessionManager.js';
import { ConfigStore } from '../../src/Store/ConfigStore.js';
import { FakeJitsiClient } from '../Platform/Jitsi/FakeJitsiClient.js';

/**
 * The dynamic membership + speaking path, driven end to end: a real
 * {@link JitsiAdapter} wrapping a {@link FakeJitsiClient}, resolved through the
 * registry exactly as production does. The test pokes the fake conference and
 * asserts the {@link VoiceSessionManager} materialises/tears down participants and
 * emits the right domain events.
 */
describe('VoiceSessionManager dynamic membership (Jitsi + fake client)', () => {
    let fake: FakeJitsiClient;
    let platform: Platform;

    beforeEach(() => {
        const dir: string = mkdtempSync(join(tmpdir(), 'audiomesh-'));
        ConfigStore.install(join(dir, 'store.json'));
        fake = new FakeJitsiClient([{ id: 'host', displayName: 'Host' }]);
        PlatformRegistry.getInstance().register(
            'jitsi',
            (config: AdapterConfig): JitsiAdapter => new JitsiAdapter(config, () => fake),
        );
        platform = ConfigStore.getInstance().createPlatform({
            kind: 'jitsi',
            name: 'Jitsi',
            enabled: true,
            config: { domain: 'meet.example.com', startMuted: true },
        });
    });

    afterEach(async () => {
        for (const session of VoiceSessionManager.getInstance().list()) {
            await VoiceSessionManager.getInstance().stop(session.sessionId);
        }
    });

    it('materialises the initial snapshot participant', async () => {
        const session = await VoiceSessionManager.getInstance().start(platform.id, 'room', false);
        expect(session.getConnectionState()).toBe('connected');
        expect(session.getParticipants().map((p) => p.platformUserId)).toEqual(['host']);
    });

    it('adds a late joiner and emits ParticipantJoined', async () => {
        const joined: string[] = [];
        const handler = (p: { participant: { platformUserId: string } }): void => {
            joined.push(p.participant.platformUserId);
        };
        EventBus.getInstance().on(AudioMeshEvent.ParticipantJoined, handler);
        try {
            const session = await VoiceSessionManager.getInstance().start(
                platform.id,
                'room',
                false,
            );
            fake.emitJoin({ id: 'late', displayName: 'Late' });

            expect(
                session
                    .getParticipants()
                    .map((p) => p.platformUserId)
                    .sort(),
            ).toEqual(['host', 'late']);
            expect(joined).toContain('late');
        } finally {
            EventBus.getInstance().off(AudioMeshEvent.ParticipantJoined, handler);
        }
    });

    it('does not double-add when a snapshot member also fires a join event', async () => {
        const session = await VoiceSessionManager.getInstance().start(platform.id, 'room', false);
        fake.emitJoin({ id: 'host', displayName: 'Host' });
        expect(session.getParticipants().map((p) => p.platformUserId)).toEqual(['host']);
    });

    it('removes a leaver and emits ParticipantLeft', async () => {
        const left: string[] = [];
        const handler = (p: { participant: { platformUserId: string } }): void => {
            left.push(p.participant.platformUserId);
        };
        EventBus.getInstance().on(AudioMeshEvent.ParticipantLeft, handler);
        try {
            const session = await VoiceSessionManager.getInstance().start(
                platform.id,
                'room',
                false,
            );
            fake.emitJoin({ id: 'late', displayName: 'Late' });
            fake.emitLeft('late');

            expect(session.getParticipants().map((p) => p.platformUserId)).toEqual(['host']);
            expect(left).toContain('late');
        } finally {
            EventBus.getInstance().off(AudioMeshEvent.ParticipantLeft, handler);
        }
    });

    it('reflects dominant-speaker changes as speaking state + SpeechStarted/Stopped', async () => {
        const started: string[] = [];
        const stopped: string[] = [];
        const onStart = (p: { speakerId: string }): void => {
            started.push(p.speakerId);
        };
        const onStop = (p: { speakerId: string }): void => {
            stopped.push(p.speakerId);
        };
        EventBus.getInstance().on(AudioMeshEvent.SpeechStarted, onStart);
        EventBus.getInstance().on(AudioMeshEvent.SpeechStopped, onStop);
        try {
            const session = await VoiceSessionManager.getInstance().start(
                platform.id,
                'room',
                false,
            );
            fake.emitJoin({ id: 'late', displayName: 'Late' });

            fake.emitDominantSpeaker('host');
            expect(
                session.getParticipants().find((p) => p.platformUserId === 'host')?.speakingState,
            ).toBe('speaking');
            expect(started).toContain('host');

            fake.emitDominantSpeaker('late');
            const host = session.getParticipants().find((p) => p.platformUserId === 'host');
            const late = session.getParticipants().find((p) => p.platformUserId === 'late');
            expect(host?.speakingState).toBe('silent');
            expect(late?.speakingState).toBe('speaking');
            expect(stopped).toContain('host');
        } finally {
            EventBus.getInstance().off(AudioMeshEvent.SpeechStarted, onStart);
            EventBus.getInstance().off(AudioMeshEvent.SpeechStopped, onStop);
        }
    });
});
