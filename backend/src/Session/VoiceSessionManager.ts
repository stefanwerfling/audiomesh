import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Session as SessionDto } from '@audiomesh/schemas';
import { Logger } from 'figtree';
import { AudioPipeline } from '../Audio/AudioPipeline.js';
import type { IAudioSink } from '../Audio/IAudio.js';
import { NullAudioSink } from '../Audio/NullAudioSink.js';
import { WavRecorderSink } from '../Audio/WavRecorderSink.js';
import { EventBus } from '../Core/EventBus.js';
import { AudioMeshEvent, type TranscriptEventData } from '../Core/Events.js';
import type {
    IAdapterEventListener,
    IChannelInfo,
    IParticipantInfo,
    IVoicePlatformAdapter,
} from '../Platform/IVoicePlatformAdapter.js';
import { PlatformRegistry } from '../Platform/PlatformRegistry.js';
import { ConfigStore } from '../Store/ConfigStore.js';
import { OpenAITranscriptionProvider } from '../Transcription/OpenAITranscriptionProvider.js';
import type {
    ITranscriptionProvider,
    TranscriptListener,
    TranscriptResult,
} from '../Transcription/ITranscriptionProvider.js';
import { Participant } from './Participant.js';
import { VoiceSession } from './VoiceSession.js';

/** Builds the transcription provider for a session (injectable for tests). */
export type TranscriptionProviderFactory = () => ITranscriptionProvider;

/** A participant's live audio pipeline together with the sink the manager owns. */
interface ParticipantPipeline {
    pipeline: AudioPipeline;
    sink: IAudioSink;
}

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
    // sessionId → (participantId → its audio pipeline + sink), so a single leaver
    // can be torn down (pipeline stopped, recording finalised) without touching
    // the rest of the session.
    private readonly _pipelines: Map<string, Map<string, ParticipantPipeline>> = new Map();
    // sessionId → its transcription provider (present only when transcription is
    // enabled for the session and OpenAI is configured).
    private readonly _transcriptions: Map<string, ITranscriptionProvider> = new Map();
    private _transcriptionFactory: TranscriptionProviderFactory = (): ITranscriptionProvider =>
        new OpenAITranscriptionProvider();

    /** Override the transcription provider (tests / alternative STT backends). */
    public setTranscriptionProviderFactory(factory: TranscriptionProviderFactory): void {
        this._transcriptionFactory = factory;
    }

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
        this._pipelines.set(sessionId, new Map());
        // Opt-in live transcription: only when requested AND OpenAI is configured.
        // Set up before participants are materialised so each gets transcribed.
        if (
            transcriptionEnabled &&
            ConfigStore.getInstance().getSettings().openai.apiKeyConfigured
        ) {
            this._transcriptions.set(sessionId, this._transcriptionFactory());
        }
        // Wire dynamic membership + speaking before connecting so no early join
        // between join and the initial snapshot is missed.
        adapter.setEventListener(this._makeListener(sessionId));
        EventBus.getInstance().emit(AudioMeshEvent.VoiceSessionStarted, { sessionId: sessionId });

        try {
            await adapter.connect();
            const channel: IChannelInfo = await adapter.joinChannel(channelId);
            session.channelName = channel.name;

            const infos: IParticipantInfo[] = await adapter.getParticipants();
            for (const info of infos) {
                this._materialiseParticipant(session, info);
            }

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
            Logger.getLogger().error(
                `VoiceSessionManager: start failed: ${(error as Error).message}`,
            );
            return session;
        }
    }

    public async stop(sessionId: string): Promise<boolean> {
        const session: VoiceSession | undefined = this._sessions.get(sessionId);
        if (session === undefined) {
            return false;
        }
        session.setConnectionState('disconnecting');
        session.getAdapter().setEventListener(null);
        const transcription: ITranscriptionProvider | undefined =
            this._transcriptions.get(sessionId);
        if (transcription !== undefined) {
            for (const participant of session.getParticipants()) {
                void transcription.stop(participant.platformUserId);
            }
            this._transcriptions.delete(sessionId);
        }
        for (const entry of this._pipelines.get(sessionId)?.values() ?? []) {
            entry.pipeline.stop();
            entry.sink.close();
        }
        this._pipelines.delete(sessionId);
        try {
            await session.getAdapter().leaveChannel();
            await session.getAdapter().disconnect();
        } catch (error: unknown) {
            Logger.getLogger().warn(
                `VoiceSessionManager: stop cleanup: ${(error as Error).message}`,
            );
        }
        session.setConnectionState('disconnected');
        session.setAudioState('idle');
        this._sessions.delete(sessionId);
        EventBus.getInstance().emit(AudioMeshEvent.VoiceSessionStopped, { sessionId: sessionId });
        return true;
    }

    /**
     * Build the per-session listener the adapter calls for post-join events. It is
     * closed over `sessionId` so several concurrent sessions stay isolated; every
     * handler resolves the live session and no-ops if it has already gone.
     */
    private _makeListener(sessionId: string): IAdapterEventListener {
        return {
            onParticipantJoined: (info: IParticipantInfo): void => {
                const session: VoiceSession | undefined = this._sessions.get(sessionId);
                if (session !== undefined) {
                    this._materialiseParticipant(session, info);
                }
            },
            onParticipantLeft: (platformUserId: string): void => {
                this._removeParticipant(sessionId, platformUserId);
            },
            onSpeakingChanged: (platformUserId: string, speaking: boolean): void => {
                this._setSpeaking(sessionId, platformUserId, speaking);
            },
        };
    }

    /**
     * Create a {@link Participant}, wire its per-participant audio pipeline and add
     * it to the session (which emits `ParticipantJoined`). Idempotent per platform
     * user, so the initial snapshot and a racing join event never double-add.
     */
    private _materialiseParticipant(session: VoiceSession, info: IParticipantInfo): void {
        if (this._findParticipant(session, info.platformUserId) !== null) {
            return;
        }
        const adapter: IVoicePlatformAdapter = session.getAdapter();
        const participant: Participant = new Participant(
            randomUUID(),
            info.platformUserId,
            info.displayName,
        );
        const source = adapter.receiveAudio(info.platformUserId);
        participant.setAudioSource(source);
        session.addParticipant(participant);

        // source → (no processors yet) → sink. The sink is a WAV recorder when
        // recording is enabled, else a counting null sink. The transcription
        // feeder is added as a processor/second sink in Phase 3.
        const sink: IAudioSink = this._makeSink(session, participant);
        const pipeline: AudioPipeline = new AudioPipeline(source, [], sink);
        pipeline.start();
        this._pipelines
            .get(session.sessionId)
            ?.set(participant.participantId, { pipeline: pipeline, sink: sink });

        this._startTranscription(session, participant);
    }

    /**
     * Begin transcribing a participant if the session has a provider. The
     * participant's per-speaker {@link IAudioSource} feeds STT alongside the
     * recording pipeline (an `IAudioSource` fans out to many listeners). Results
     * become `TranscriptPartial`/`TranscriptFinal` events → WS → UI. Fire-and-
     * forget: a failed STT session must not stall session start (fault isolation).
     */
    private _startTranscription(session: VoiceSession, participant: Participant): void {
        const provider: ITranscriptionProvider | undefined = this._transcriptions.get(
            session.sessionId,
        );
        const source = participant.getAudioSource();
        if (provider === undefined || source === null) {
            return;
        }
        const onResult: TranscriptListener = (result: TranscriptResult): void => {
            const line: TranscriptEventData = {
                speakerId: result.speakerId,
                speakerName: participant.displayName,
                text: result.text,
                final: result.final,
                timestamp: result.timestamp,
            };
            if (result.language !== undefined) {
                line.language = result.language;
            }
            if (result.confidence !== undefined) {
                line.confidence = result.confidence;
            }
            EventBus.getInstance().emit(
                result.final ? AudioMeshEvent.TranscriptFinal : AudioMeshEvent.TranscriptPartial,
                { sessionId: session.sessionId, line: line },
            );
        };
        provider
            .start(participant.platformUserId, source, onResult)
            .catch((error: unknown): void => {
                EventBus.getInstance().emit(AudioMeshEvent.ErrorOccurred, {
                    component: 'VoiceSessionManager',
                    message: `transcription start failed: ${(error as Error).message}`,
                    sessionId: session.sessionId,
                });
            });
    }

    /**
     * Pick the pipeline sink for a participant. Recording is opt-in and gated by
     * the global `privacy.recordingEnabled` setting (platform-agnostic — the same
     * for every adapter). One WAV per participant lands under
     * `<dataDir>/recordings/<sessionId>/`. Any setup failure degrades to a null
     * sink and an `ErrorOccurred` event — recording must never block a session.
     */
    private _makeSink(session: VoiceSession, participant: Participant): IAudioSink {
        const nullSink: NullAudioSink = new NullAudioSink(`sink-${participant.participantId}`);
        if (!ConfigStore.getInstance().getSettings().privacy.recordingEnabled) {
            return nullSink;
        }
        try {
            const dir: string = join(
                ConfigStore.getInstance().getBaseDir(),
                'recordings',
                session.sessionId,
            );
            mkdirSync(dir, { recursive: true });
            const safeName: string = participant.platformUserId.replace(/[^a-zA-Z0-9._-]/g, '_');
            const file: string = join(dir, `${safeName}.wav`);
            return new WavRecorderSink(`rec-${participant.participantId}`, file);
        } catch (error: unknown) {
            EventBus.getInstance().emit(AudioMeshEvent.ErrorOccurred, {
                component: 'VoiceSessionManager',
                message: `recording setup failed: ${(error as Error).message}`,
                sessionId: session.sessionId,
            });
            return nullSink;
        }
    }

    private _removeParticipant(sessionId: string, platformUserId: string): void {
        const session: VoiceSession | undefined = this._sessions.get(sessionId);
        if (session === undefined) {
            return;
        }
        const participant: Participant | null = this._findParticipant(session, platformUserId);
        if (participant === null) {
            return;
        }
        const pipelines: Map<string, ParticipantPipeline> | undefined =
            this._pipelines.get(sessionId);
        const entry: ParticipantPipeline | undefined = pipelines?.get(participant.participantId);
        if (entry !== undefined) {
            entry.pipeline.stop();
            entry.sink.close(); // finalise the WAV header when recording.
            pipelines?.delete(participant.participantId);
        }
        void this._transcriptions.get(sessionId)?.stop(participant.platformUserId);
        session.removeParticipant(participant.participantId);
    }

    private _setSpeaking(sessionId: string, platformUserId: string, speaking: boolean): void {
        const session: VoiceSession | undefined = this._sessions.get(sessionId);
        if (session === undefined) {
            return;
        }
        const participant: Participant | null = this._findParticipant(session, platformUserId);
        if (participant === null) {
            return;
        }
        participant.speakingState = speaking ? 'speaking' : 'silent';
        EventBus.getInstance().emit(
            speaking ? AudioMeshEvent.SpeechStarted : AudioMeshEvent.SpeechStopped,
            { sessionId: sessionId, speakerId: platformUserId },
        );
        if (speaking) {
            EventBus.getInstance().emit(AudioMeshEvent.SpeakerChanged, {
                sessionId: sessionId,
                speakerId: platformUserId,
            });
        }
    }

    private _findParticipant(session: VoiceSession, platformUserId: string): Participant | null {
        for (const participant of session.getParticipants()) {
            if (participant.platformUserId === platformUserId) {
                return participant;
            }
        }
        return null;
    }
}
