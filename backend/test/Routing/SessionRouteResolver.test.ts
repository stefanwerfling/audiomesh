import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Platform, RouteNode } from '@audiomesh/schemas';
import type { IAudioFrame } from '../../src/Audio/AudioFormat.js';
import type { IAudioSink, IAudioSource } from '../../src/Audio/IAudio.js';
import { JitsiAdapter } from '../../src/Platform/Adapters/Jitsi/JitsiAdapter.js';
import { PlatformRegistry } from '../../src/Platform/PlatformRegistry.js';
import type { AdapterConfig } from '../../src/Platform/IVoicePlatformAdapter.js';
import { SessionRouteResolver } from '../../src/Routing/SessionRouteResolver.js';
import { VoiceSession } from '../../src/Session/VoiceSession.js';
import { VoiceSessionManager } from '../../src/Session/VoiceSessionManager.js';
import { ConfigStore } from '../../src/Store/ConfigStore.js';
import { FakeJitsiClient } from '../Platform/Jitsi/FakeJitsiClient.js';

describe('SessionRouteResolver (live session)', () => {
    let fake: FakeJitsiClient;
    let platform: Platform;
    const resolver: SessionRouteResolver = new SessionRouteResolver();

    beforeEach(() => {
        const dir: string = mkdtempSync(join(tmpdir(), 'audiomesh-route-'));
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
    });

    afterEach(async () => {
        for (const session of VoiceSessionManager.getInstance().list()) {
            await VoiceSessionManager.getInstance().stop(session.sessionId);
        }
    });

    it("mixes a session's participant audio into the source", async () => {
        const session: VoiceSession = await VoiceSessionManager.getInstance().start(
            platform.id,
            'room',
            false,
        );
        const node: RouteNode = {
            id: 's',
            kind: 'source',
            type: 'session',
            ref: session.sessionId,
        };
        const source: IAudioSource = resolver.resolveSource(node);
        const frames: IAudioFrame[] = [];
        source.onFrame((f: IAudioFrame): void => {
            frames.push(f);
        });

        fake.emitAudio({
            participantId: 'host',
            samples: new Int16Array(48000).fill(200),
            sampleRate: 48000,
        });
        expect(frames.length).toBeGreaterThan(0);
        expect(frames[0]!.speakerId).toBe('host');
        source.close();
    });

    it('resolves a session sink to the adapter send path', async () => {
        const session: VoiceSession = await VoiceSessionManager.getInstance().start(
            platform.id,
            'room',
            false,
        );
        const sink: IAudioSink = resolver.resolveSink({
            id: 'k',
            kind: 'sink',
            type: 'session',
            ref: session.sessionId,
        });
        expect(sink.id).toBe('jitsi-out');
    });

    it('throws for an unknown session', () => {
        expect(() =>
            resolver.resolveSource({ id: 's', kind: 'source', type: 'session', ref: 'nope' }),
        ).toThrow(/unknown session/);
    });

    it('resolves gain and null nodes', () => {
        expect(
            resolver.resolveProcessor({ id: 'p', kind: 'processor', type: 'gain', ref: '2' }),
        ).not.toBeNull();
        expect(
            resolver.resolveProcessor({ id: 'p', kind: 'processor', type: 'passthrough' }),
        ).toBeNull();
        expect(resolver.resolveSink({ id: 'n', kind: 'sink', type: 'null' }).id).toContain('null');
    });
});
