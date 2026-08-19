import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Platform } from '@audiomesh/schemas';
import { MockVoiceAdapter } from '../../src/Platform/Adapters/MockVoiceAdapter.js';
import { PlatformRegistry } from '../../src/Platform/PlatformRegistry.js';
import type { AdapterConfig } from '../../src/Platform/IVoicePlatformAdapter.js';
import { VoiceSessionManager } from '../../src/Session/VoiceSessionManager.js';
import { ConfigStore } from '../../src/Store/ConfigStore.js';

describe('VoiceSessionManager (with MockVoiceAdapter)', () => {

    let platform: Platform;

    beforeEach(() => {
        const dir: string = mkdtempSync(join(tmpdir(), 'audiomesh-'));
        ConfigStore.install(join(dir, 'store.json'));
        PlatformRegistry.getInstance().register(
            'mock',
            (config: AdapterConfig): MockVoiceAdapter => new MockVoiceAdapter(config),
        );
        platform = ConfigStore.getInstance().createPlatform({ kind: 'mock', name: 'Mock', enabled: true });
    });

    afterEach(async () => {
        for (const session of VoiceSessionManager.getInstance().list()) {
            await VoiceSessionManager.getInstance().stop(session.sessionId);
        }
    });

    it('starts a session and materialises the channel participants', async () => {
        const session = await VoiceSessionManager.getInstance().start(platform.id, 'general', false);
        expect(session.getConnectionState()).toBe('connected');
        expect(session.getParticipants().map((p) => p.displayName)).toEqual(['Stefan', 'Max', 'Julia']);
        const listed = VoiceSessionManager.getInstance().list();
        expect(listed.some((s) => s.sessionId === session.sessionId)).toBe(true);
    });

    it('stops a session and removes it from the list', async () => {
        const session = await VoiceSessionManager.getInstance().start(platform.id, 'general', false);
        const ok: boolean = await VoiceSessionManager.getInstance().stop(session.sessionId);
        expect(ok).toBe(true);
        expect(VoiceSessionManager.getInstance().get(session.sessionId)).toBeNull();
    });

    it('marks the session failed for an unknown channel without throwing', async () => {
        const session = await VoiceSessionManager.getInstance().start(platform.id, 'does-not-exist', false);
        expect(session.getConnectionState()).toBe('failed');
    });

});
