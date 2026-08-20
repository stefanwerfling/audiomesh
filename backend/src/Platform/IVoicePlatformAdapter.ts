import type { PlatformKind } from '@audiomesh/schemas';
import type { IAudioSink, IAudioSource } from '../Audio/IAudio.js';

/** A joinable channel/room/meeting on a platform. */
export interface IChannelInfo {
    id: string;
    name: string;
}

/** A participant as reported by a platform adapter (pre-`Participant` object). */
export interface IParticipantInfo {
    platformUserId: string;
    displayName: string;
}

/** Static config passed to an adapter on construction (opaque per platform). */
export type AdapterConfig = Record<string, unknown>;

/**
 * Live callbacks an adapter raises as the channel changes *after* join — the seam
 * for dynamic membership and speaking activity. The {@link VoiceSessionManager}
 * registers one listener per session so late joiners get a `Participant` + audio
 * pipeline, leavers are torn down, and speaking transitions become domain events.
 * All identifiers are the platform's own user id (matching {@link IParticipantInfo}).
 */
export interface IAdapterEventListener {
    onParticipantJoined(participant: IParticipantInfo): void;
    onParticipantLeft(platformUserId: string): void;
    /** Speaking activity toggled for a participant (e.g. Jitsi dominant speaker). */
    onSpeakingChanged(platformUserId: string, speaking: boolean): void;
}

/**
 * The single seam every voice platform plugs into. The Core talks only to this
 * interface — Discord/TeamSpeak/Jitsi live entirely inside their own
 * implementation. **Adding a platform must not require Core changes**: write a
 * new class implementing this and register a factory in the `PlatformRegistry`.
 *
 * Audio is exposed as streaming sources/sinks in the internal PCM format; the
 * adapter is responsible for converting to/from the platform's native codec.
 */
export interface IVoicePlatformAdapter {
    readonly kind: PlatformKind;

    connect(): Promise<void>;
    disconnect(): Promise<void>;
    isConnected(): boolean;

    getChannels(): Promise<IChannelInfo[]>;
    joinChannel(channelId: string): Promise<IChannelInfo>;
    leaveChannel(): Promise<void>;
    getParticipants(): Promise<IParticipantInfo[]>;

    /**
     * Register (or clear with `null`) the listener for post-join membership and
     * speaking events. Set before `connect`/`joinChannel` so no early join is
     * missed. Adapters that have no dynamic events may store and never call it.
     */
    setEventListener(listener: IAdapterEventListener | null): void;

    /** Per-participant receive stream (internal PCM). */
    receiveAudio(participantId: string): IAudioSource;
    /** Outbound mixed audio to the channel (internal PCM). */
    sendAudio(): IAudioSink;

    mute(): Promise<void>;
    unmute(): Promise<void>;
}

/** Factory signature the registry stores per platform kind. */
export type VoicePlatformAdapterFactory = (config: AdapterConfig) => IVoicePlatformAdapter;
