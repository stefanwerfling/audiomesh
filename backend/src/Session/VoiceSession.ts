import type {
    AudioState,
    ConnectionState,
    PlatformKind,
    Session as SessionDto,
} from '@audiomesh/schemas';
import { EventBus } from '../Core/EventBus.js';
import { AudioMeshEvent } from '../Core/Events.js';
import type { IVoicePlatformAdapter } from '../Platform/IVoicePlatformAdapter.js';
import { Participant } from './Participant.js';

/**
 * A live voice connection: identity, lifecycle state and its participants, bound
 * to one platform adapter. State transitions go through {@link setConnectionState}
 * so every change emits a `SessionStateChanged` event onto the bus (→ WS → UI).
 * The session owns no platform-specific logic — only the adapter does.
 */
export class VoiceSession {

    public readonly sessionId: string;
    public readonly platform: PlatformKind;
    public readonly platformId: string;
    public readonly channelId: string;
    public channelName: string;
    public transcriptionEnabled: boolean;
    public readonly createdAt: number;
    public connectedAt: number | null = null;

    private _connectionState: ConnectionState = 'connecting';
    private _audioState: AudioState = 'idle';
    private readonly _participants: Map<string, Participant> = new Map();
    private readonly _adapter: IVoicePlatformAdapter;
    private readonly _metadata: Record<string, unknown> = {};

    public constructor(
        sessionId: string,
        platform: PlatformKind,
        platformId: string,
        channelId: string,
        channelName: string,
        transcriptionEnabled: boolean,
        adapter: IVoicePlatformAdapter,
    ) {
        this.sessionId = sessionId;
        this.platform = platform;
        this.platformId = platformId;
        this.channelId = channelId;
        this.channelName = channelName;
        this.transcriptionEnabled = transcriptionEnabled;
        this.createdAt = Date.now();
        this._adapter = adapter;
    }

    public getAdapter(): IVoicePlatformAdapter {
        return this._adapter;
    }

    public getConnectionState(): ConnectionState {
        return this._connectionState;
    }

    public setConnectionState(state: ConnectionState): void {
        if (this._connectionState === state) {
            return;
        }
        this._connectionState = state;
        if (state === 'connected' && this.connectedAt === null) {
            this.connectedAt = Date.now();
        }
        EventBus.getInstance().emit(AudioMeshEvent.SessionStateChanged, {
            sessionId: this.sessionId,
            connectionState: state,
        });
    }

    public getAudioState(): AudioState {
        return this._audioState;
    }

    public setAudioState(state: AudioState): void {
        this._audioState = state;
    }

    public addParticipant(participant: Participant): void {
        this._participants.set(participant.participantId, participant);
        EventBus.getInstance().emit(AudioMeshEvent.ParticipantJoined, {
            sessionId: this.sessionId,
            participant: {
                participantId: participant.participantId,
                platformUserId: participant.platformUserId,
                displayName: participant.displayName,
                speakingState: participant.speakingState,
                muted: participant.muted,
            },
        });
    }

    public removeParticipant(participantId: string): void {
        const participant: Participant | undefined = this._participants.get(participantId);
        if (participant === undefined) {
            return;
        }
        this._participants.delete(participantId);
        EventBus.getInstance().emit(AudioMeshEvent.ParticipantLeft, {
            sessionId: this.sessionId,
            participant: {
                participantId: participant.participantId,
                platformUserId: participant.platformUserId,
                displayName: participant.displayName,
                speakingState: participant.speakingState,
                muted: participant.muted,
            },
        });
    }

    public getParticipants(): Participant[] {
        return [...this._participants.values()];
    }

    public getMetadata(): Record<string, unknown> {
        return this._metadata;
    }

    public toDto(): SessionDto {
        const dto: SessionDto = {
            sessionId: this.sessionId,
            platform: this.platform,
            platformId: this.platformId,
            channelId: this.channelId,
            channelName: this.channelName,
            connectionState: this._connectionState,
            audioState: this._audioState,
            transcriptionEnabled: this.transcriptionEnabled,
            participants: this.getParticipants().map((p: Participant): ReturnType<Participant['toDto']> =>
                p.toDto(),
            ),
            createdAt: this.createdAt,
        };
        if (this.connectedAt !== null) {
            dto.connectedAt = this.connectedAt;
        }
        return dto;
    }

}
