import { existsSync, mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Platform, Settings } from '@audiomesh/schemas';
import { JitsiAdapter } from '../../src/Platform/Adapters/Jitsi/JitsiAdapter.js';
import { PlatformRegistry } from '../../src/Platform/PlatformRegistry.js';
import type { AdapterConfig } from '../../src/Platform/IVoicePlatformAdapter.js';
import { VoiceSession } from '../../src/Session/VoiceSession.js';
import { VoiceSessionManager } from '../../src/Session/VoiceSessionManager.js';
import { ConfigStore } from '../../src/Store/ConfigStore.js';
import { FakeJitsiClient } from '../Platform/Jitsi/FakeJitsiClient.js';

function setRecording(enabled: boolean): void {
    const s: Settings = ConfigStore.getInstance().getSettings();
    ConfigStore.getInstance().saveSettings({
        openai: {
            model: s.openai.model,
            transcriptionModel: s.openai.transcriptionModel,
            ttsModel: s.openai.ttsModel,
            voice: s.openai.voice,
        },
        privacy: {
            recordingEnabled: enabled,
            transcriptStorageEnabled: s.privacy.transcriptStorageEnabled,
            retentionDays: s.privacy.retentionDays,
        },
    });
}

describe('VoiceSessionManager recording (privacy.recordingEnabled)', () => {
    let baseDir: string;
    let fake: FakeJitsiClient;
    let platform: Platform;

    beforeEach(() => {
        baseDir = mkdtempSync(join(tmpdir(), 'audiomesh-rec-'));
        ConfigStore.install(join(baseDir, 'store.json'));
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
    });

    afterEach(async () => {
        for (const session of VoiceSessionManager.getInstance().list()) {
            await VoiceSessionManager.getInstance().stop(session.sessionId);
        }
    });

    it('writes a per-participant WAV when recording is enabled', async () => {
        setRecording(true);
        const session: VoiceSession = await VoiceSessionManager.getInstance().start(
            platform.id,
            'room',
            false,
        );
        // Push 1 s of 48 kHz audio for the host → internal frames → recorder.
        fake.emitAudio({
            participantId: 'host',
            samples: new Int16Array(48000).fill(500),
            sampleRate: 48000,
        });
        await VoiceSessionManager.getInstance().stop(session.sessionId);

        const file: string = join(baseDir, 'recordings', session.sessionId, 'host.wav');
        expect(existsSync(file)).toBe(true);
        const buf: Buffer = readFileSync(file);
        expect(buf.subarray(0, 4).toString('ascii')).toBe('RIFF');
        expect(buf.readUInt32LE(24)).toBe(16000); // internal sample rate
        expect(statSync(file).size).toBeGreaterThan(44); // header + real audio
    });

    it('writes no recordings when recording is disabled', async () => {
        setRecording(false);
        const session: VoiceSession = await VoiceSessionManager.getInstance().start(
            platform.id,
            'room',
            false,
        );
        fake.emitAudio({
            participantId: 'host',
            samples: new Int16Array(16000).fill(1),
            sampleRate: 48000,
        });
        await VoiceSessionManager.getInstance().stop(session.sessionId);

        expect(existsSync(join(baseDir, 'recordings', session.sessionId))).toBe(false);
    });

    it('finalises a leaver’s recording when they leave mid-session', async () => {
        setRecording(true);
        const session: VoiceSession = await VoiceSessionManager.getInstance().start(
            platform.id,
            'room',
            false,
        );
        fake.emitJoin({ id: 'late', displayName: 'Late' });
        fake.emitAudio({
            participantId: 'late',
            samples: new Int16Array(48000).fill(300),
            sampleRate: 48000,
        });
        fake.emitLeft('late');

        const file: string = join(baseDir, 'recordings', session.sessionId, 'late.wav');
        expect(existsSync(file)).toBe(true);
        // Header backfilled on close → RIFF size matches file length.
        const buf: Buffer = readFileSync(file);
        expect(buf.readUInt32LE(4)).toBe(buf.length - 8);
    });
});
