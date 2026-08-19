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

    /** Per-participant receive stream (internal PCM). */
    receiveAudio(participantId: string): IAudioSource;
    /** Outbound mixed audio to the channel (internal PCM). */
    sendAudio(): IAudioSink;

    mute(): Promise<void>;
    unmute(): Promise<void>;
}

/** Factory signature the registry stores per platform kind. */
export type VoicePlatformAdapterFactory = (config: AdapterConfig) => IVoicePlatformAdapter;
