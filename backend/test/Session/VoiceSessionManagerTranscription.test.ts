import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Platform, Settings } from '@audiomesh/schemas';
import { EventBus } from '../../src/Core/EventBus.js';
import { AudioMeshEvent, type TranscriptEventData } from '../../src/Core/Events.js';
import { JitsiAdapter } from '../../src/Platform/Adapters/Jitsi/JitsiAdapter.js';
import { PlatformRegistry } from '../../src/Platform/PlatformRegistry.js';
import type { AdapterConfig } from '../../src/Platform/IVoicePlatformAdapter.js';
import { VoiceSessionManager } from '../../src/Session/VoiceSessionManager.js';
import { ConfigStore } from '../../src/Store/ConfigStore.js';
import { OpenAITranscriptionProvider } from '../../src/Transcription/OpenAITranscriptionProvider.js';
import { FakeJitsiClient } from '../Platform/Jitsi/FakeJitsiClient.js';
import { FakeTranscriptionSession } from '../Transcription/FakeTranscriptionSession.js';

function setApiKey(key: string): void {
    const s: Settings = ConfigStore.getInstance().getSettings();
    ConfigStore.getInstance().saveSettings({
        openai: {
            apiKey: key,
            model: s.openai.model,
            transcriptionModel: s.openai.transcriptionModel,
            ttsModel: s.openai.ttsModel,
            voice: s.openai.voice,
        },
        privacy: s.privacy,
    });
}

const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

describe('VoiceSessionManager transcription wiring', () => {
    let fake: FakeJitsiClient;
    let platform: Platform;
    let sessions: FakeTranscriptionSession[];

    beforeEach(() => {
        const dir: string = mkdtempSync(join(tmpdir(), 'audiomesh-stt-'));
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
            config: { domain: 'meet.example.com' },
        });
        sessions = [];
        VoiceSessionManager.getInstance().setTranscriptionProviderFactory(
            () =>
                new OpenAITranscriptionProvider(() => {
                    const s: FakeTranscriptionSession = new FakeTranscriptionSession(24000);
                    sessions.push(s);
                    return s;
                }),
        );
    });

    afterEach(async () => {
        for (const session of VoiceSessionManager.getInstance().list()) {
            await VoiceSessionManager.getInstance().stop(session.sessionId);
        }
    });

    it('emits TranscriptFinal with speaker + text when enabled and key present', async () => {
        setApiKey('sk-test');
        const finals: TranscriptEventData[] = [];
        const handler = (p: { line: TranscriptEventData }): void => {
            finals.push(p.line);
        };
        EventBus.getInstance().on(AudioMeshEvent.TranscriptFinal, handler);
        try {
            const session = await VoiceSessionManager.getInstance().start(
                platform.id,
                'room',
                true,
            );
            await tick(); // let the fire-and-forget provider.start subscribe
            expect(sessions).toHaveLength(1);

            sessions[0]!.emitFinal('hallo welt');
            expect(finals).toHaveLength(1);
            expect(finals[0]!.speakerId).toBe('host');
            expect(finals[0]!.speakerName).toBe('Host');
            expect(finals[0]!.text).toBe('hallo welt');
            expect(finals[0]!.final).toBe(true);
            void session;
        } finally {
            EventBus.getInstance().off(AudioMeshEvent.TranscriptFinal, handler);
        }
    });

    it('emits TranscriptPartial for interim results', async () => {
        setApiKey('sk-test');
        const partials: string[] = [];
        const handler = (p: { line: TranscriptEventData }): void => {
            partials.push(p.line.text);
        };
        EventBus.getInstance().on(AudioMeshEvent.TranscriptPartial, handler);
        try {
            await VoiceSessionManager.getInstance().start(platform.id, 'room', true);
            await tick();
            sessions[0]!.emitPartial('hal');
            expect(partials).toEqual(['hal']);
        } finally {
            EventBus.getInstance().off(AudioMeshEvent.TranscriptPartial, handler);
        }
    });

    it('does not transcribe when transcription is disabled', async () => {
        setApiKey('sk-test');
        await VoiceSessionManager.getInstance().start(platform.id, 'room', false);
        await tick();
        expect(sessions).toHaveLength(0);
    });

    it('does not transcribe when no OpenAI key is configured', async () => {
        // key left empty
        await VoiceSessionManager.getInstance().start(platform.id, 'room', true);
        await tick();
        expect(sessions).toHaveLength(0);
    });

    it('transcribes a late joiner too', async () => {
        setApiKey('sk-test');
        await VoiceSessionManager.getInstance().start(platform.id, 'room', true);
        await tick();
        expect(sessions).toHaveLength(1); // host
        fake.emitJoin({ id: 'late', displayName: 'Late' });
        await tick();
        expect(sessions).toHaveLength(2); // + late
    });
});
