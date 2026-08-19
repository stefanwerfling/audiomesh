import { randomUUID } from 'node:crypto';
import type { Session as SessionDto } from '@audiomesh/schemas';
import { Logger } from 'figtree';
import { AudioPipeline } from '../Audio/AudioPipeline.js';
import { NullAudioSink } from '../Audio/NullAudioSink.js';
import { EventBus } from '../Core/EventBus.js';
import { AudioMeshEvent } from '../Core/Events.js';
import type { IChannelInfo, IParticipantInfo } from '../Platform/IVoicePlatformAdapter.js';
import { PlatformRegistry } from '../Platform/PlatformRegistry.js';
import { ConfigStore } from '../Store/ConfigStore.js';
import { Participant } from './Participant.js';
import { VoiceSession } from './VoiceSession.js';

/**
 * Owns the set of live {@link VoiceSession}s and drives their lifecycle. Resolves
 * an adapter from the {@link PlatformRegistry} by the platform's kind, connects,
 * joins the channel, materialises participants and wires a per-participant audio
 * pipeline. All platform specifics stay behind the adapter — the manager is
 * platform-agnostic.
 *
 * Fault isolation: a failing adapter marks its session `failed` and emits
 * `ErrorOccurred`; it never throws out of `start`/`stop` far enough to crash the
 * process or other sessions.
 */
export class VoiceSessionManager {

    private static _instance: VoiceSessionManager | null = null;

    public static getInstance(): VoiceSessionManager {
        if (VoiceSessionManager._instance === null) {
            VoiceSessionManager._instance = new VoiceSessionManager();
        }
        return VoiceSessionManager._instance;
    }

    private readonly _sessions: Map<string, VoiceSession> = new Map();
    private readonly _pipelines: Map<string, AudioPipeline[]> = new Map();

    public list(): SessionDto[] {
        return [...this._sessions.values()].map((s: VoiceSession): SessionDto => s.toDto());
    }

    public get(sessionId: string): VoiceSession | null {
        return this._sessions.get(sessionId) ?? null;
    }

    public async start(
        platformId: string,
        channelId: string,
        transcriptionEnabled: boolean,
    ): Promise<VoiceSession> {
        const stored = ConfigStore.getInstance().getStoredPlatform(platformId);
        if (stored === null) {
            throw new Error(`VoiceSessionManager: unknown platform '${platformId}'`);
        }
        const registry: PlatformRegistry = PlatformRegistry.getInstance();
        if (!registry.has(stored.kind)) {
            throw new Error(`VoiceSessionManager: no adapter for kind '${stored.kind}'`);
        }

        const adapter = registry.create(stored.kind, stored.config);
        const sessionId: string = randomUUID();
        const session: VoiceSession = new VoiceSession(
            sessionId,
            stored.kind,
            platformId,
            channelId,
            channelId,
            transcriptionEnabled,
            adapter,
        );
        this._sessions.set(sessionId, session);
        EventBus.getInstance().emit(AudioMeshEvent.VoiceSessionStarted, { sessionId: sessionId });

        try {
            await adapter.connect();
            const channel: IChannelInfo = await adapter.joinChannel(channelId);
            session.channelName = channel.name;

            const infos: IParticipantInfo[] = await adapter.getParticipants();
            const pipelines: AudioPipeline[] = [];
            for (const info of infos) {
                const participant: Participant = new Participant(
                    randomUUID(),
                    info.platformUserId,
                    info.displayName,
                );
                const source = adapter.receiveAudio(info.platformUserId);
                participant.setAudioSource(source);
                session.addParticipant(participant);

                // MVP wiring: source → (no processors yet) → counting sink. The
                // transcription feeder replaces the sink in Phase 3.
                const pipeline: AudioPipeline = new AudioPipeline(
                    source,
                    [],
                    new NullAudioSink(`sink-${participant.participantId}`),
                );
                pipeline.start();
                pipelines.push(pipeline);
            }
            this._pipelines.set(sessionId, pipelines);

            session.setConnectionState('connected');
            session.setAudioState('active');
            EventBus.getInstance().emit(AudioMeshEvent.AudioStarted, { sessionId: sessionId });
            return session;
        } catch (error: unknown) {
            session.setConnectionState('failed');
            EventBus.getInstance().emit(AudioMeshEvent.ErrorOccurred, {
                component: 'VoiceSessionManager',
                message: `start failed: ${(error as Error).message}`,
                sessionId: sessionId,
            });
            Logger.getLogger().error(`VoiceSessionManager: start failed: ${(error as Error).message}`);
            return session;
        }
    }

    public async stop(sessionId: string): Promise<boolean> {
        const session: VoiceSession | undefined = this._sessions.get(sessionId);
        if (session === undefined) {
            return false;
        }
        session.setConnectionState('disconnecting');
        for (const pipeline of this._pipelines.get(sessionId) ?? []) {
            pipeline.stop();
        }
        this._pipelines.delete(sessionId);
        try {
            await session.getAdapter().leaveChannel();
            await session.getAdapter().disconnect();
        } catch (error: unknown) {
            Logger.getLogger().warn(`VoiceSessionManager: stop cleanup: ${(error as Error).message}`);
        }
        session.setConnectionState('disconnected');
        session.setAudioState('idle');
        this._sessions.delete(sessionId);
        EventBus.getInstance().emit(AudioMeshEvent.VoiceSessionStopped, { sessionId: sessionId });
        return true;
    }

}
