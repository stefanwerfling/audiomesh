import type { Participant as ParticipantDto, SpeakingState } from '@audiomesh/schemas';
import type { IAudioSource } from '../Audio/IAudio.js';

/**
 * A participant inside a live session. Holds the platform identity plus live
 * speaking/mute state and — crucially — a per-participant {@link IAudioSource}.
 * Keeping audio per participant (rather than one mixed channel stream) is what
 * lets transcription attribute text to a speaker and enables future diarization.
 */
export class Participant {

    public readonly participantId: string;
    public readonly platformUserId: string;
    public readonly displayName: string;
    public speakingState: SpeakingState = 'silent';
    public muted: boolean = false;

    private _audioSource: IAudioSource | null = null;
    private readonly _metadata: Record<string, unknown> = {};

    public constructor(participantId: string, platformUserId: string, displayName: string) {
        this.participantId = participantId;
        this.platformUserId = platformUserId;
        this.displayName = displayName;
    }

    public setAudioSource(source: IAudioSource): void {
        this._audioSource = source;
    }

    public getAudioSource(): IAudioSource | null {
        return this._audioSource;
    }

    public getMetadata(): Record<string, unknown> {
        return this._metadata;
    }

    public toDto(): ParticipantDto {
        return {
            participantId: this.participantId,
            platformUserId: this.platformUserId,
            displayName: this.displayName,
            speakingState: this.speakingState,
            muted: this.muted,
        };
    }

}
