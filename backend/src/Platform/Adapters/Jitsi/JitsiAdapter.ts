import type { PlatformKind } from '@audiomesh/schemas';
import { Logger } from 'figtree';
import { INTERNAL_AUDIO_FORMAT } from '../../../Audio/AudioFormat.js';
import type { IAudioSink, IAudioSource } from '../../../Audio/IAudio.js';
import { PcmFrameAssembler } from '../../../Audio/PcmFrameAssembler.js';
import { PcmResampler } from '../../../Audio/PcmResampler.js';
import { PushAudioSource } from '../../../Audio/PushAudioSource.js';
import { EventBus } from '../../../Core/EventBus.js';
import { AudioMeshEvent } from '../../../Core/Events.js';
import type {
    AdapterConfig,
    IAdapterEventListener,
    IChannelInfo,
    IParticipantInfo,
    IVoicePlatformAdapter,
} from '../../IVoicePlatformAdapter.js';
import type { IJitsiClient, JitsiAudioData, JitsiParticipant } from './IJitsiClient.js';
import { parseJitsiConfig, type JitsiConfig } from './JitsiConfig.js';
import { JitsiSendSink } from './JitsiSendSink.js';

/** Per-participant receive state: the mesh source plus its conversion chain. */
interface ParticipantAudio {
    source: PushAudioSource;
    resampler: PcmResampler;
    assembler: PcmFrameAssembler;
}

/** Factory the adapter uses to build its client — swapped for a fake in tests. */
export type JitsiClientFactory = (config: JitsiConfig) => IJitsiClient;

/**
 * Jitsi Meet voice platform adapter. A headless bot joins a conference over
 * `lib-jitsi-meet`, receives each remote participant's WebRTC audio track as
 * native-rate Int16 PCM, and republishes it as internal-format
 * {@link IAudioSource}s the mesh can transcribe and route.
 *
 * All Jitsi/WebRTC specifics live behind {@link IJitsiClient}; this class only
 * maps that transport onto the {@link IVoicePlatformAdapter} contract — channels,
 * participants, per-participant sources, mute — and converts audio into the
 * canonical mesh format. Errors from the client are turned into `ErrorOccurred`
 * events and never thrown up into the Core (fault-isolation rule).
 *
 * Jitsi has no server-side room directory, so {@link getChannels} echoes the
 * configured/most-recently-joined room rather than enumerating — a room is
 * created on demand the moment the bot joins it.
 */
export class JitsiAdapter implements IVoicePlatformAdapter {
    public readonly kind: PlatformKind = 'jitsi';

    private readonly _config: JitsiConfig;
    private readonly _client: IJitsiClient;

    private readonly _participants: Map<string, JitsiParticipant> = new Map();
    private readonly _audio: Map<string, ParticipantAudio> = new Map();
    private readonly _sink: JitsiSendSink;

    private _connected: boolean = false;
    private _joinedRoom: string | null = null;
    private _muted: boolean;
    private _listener: IAdapterEventListener | null = null;
    private _dominantSpeaker: string | null = null;

    public constructor(config: AdapterConfig, clientFactory: JitsiClientFactory) {
        this._config = parseJitsiConfig(config);
        this._client = clientFactory(this._config);
        this._muted = this._config.startMuted;
        this._sink = new JitsiSendSink(
            this._client.getSendSampleRate(),
            (): boolean => this._muted,
            (samples: Int16Array, sampleRate: number): void =>
                this._client.sendAudio(samples, sampleRate),
        );
        this._client.setHandlers({
            onParticipantJoined: (p: JitsiParticipant): void => this._onParticipantJoined(p),
            onParticipantLeft: (id: string): void => this._onParticipantLeft(id),
            onAudioData: (data: JitsiAudioData): void => this._onAudioData(data),
            onDominantSpeakerChanged: (id: string | null): void => this._onDominantSpeaker(id),
            onError: (message: string): void => this._onError(message),
        });
    }

    public setEventListener(listener: IAdapterEventListener | null): void {
        this._listener = listener;
    }

    public async connect(): Promise<void> {
        await this._client.connect();
        this._connected = this._client.isConnected();
    }

    public async disconnect(): Promise<void> {
        try {
            await this._client.leaveRoom();
            await this._client.disconnect();
        } finally {
            this._connected = false;
            this._joinedRoom = null;
            this._sink.close();
            for (const audio of this._audio.values()) {
                audio.source.close();
            }
            this._audio.clear();
            this._participants.clear();
        }
    }

    public isConnected(): boolean {
        return this._connected;
    }

    public async getChannels(): Promise<IChannelInfo[]> {
        // No room enumeration in Jitsi; expose the joined room, or nothing yet.
        if (this._joinedRoom !== null) {
            return [{ id: this._joinedRoom, name: this._joinedRoom }];
        }
        return [];
    }

    public async joinChannel(channelId: string): Promise<IChannelInfo> {
        if (channelId.trim().length === 0) {
            throw new Error('JitsiAdapter: channelId (room name) must not be empty');
        }
        await this._client.joinRoom(channelId);
        this._joinedRoom = channelId;
        // Seed the participant snapshot the client already knows about.
        for (const p of this._client.getParticipants()) {
            this._participants.set(p.id, p);
        }
        if (this._config.startMuted) {
            await this._client.setMuted(true);
        }
        return { id: channelId, name: channelId };
    }

    public async leaveChannel(): Promise<void> {
        await this._client.leaveRoom();
        this._joinedRoom = null;
    }

    public async getParticipants(): Promise<IParticipantInfo[]> {
        return [...this._participants.values()].map((p: JitsiParticipant): IParticipantInfo => ({
            platformUserId: p.id,
            displayName: p.displayName,
        }));
    }

    public receiveAudio(participantId: string): IAudioSource {
        return this._ensureAudio(participantId).source;
    }

    public sendAudio(): IAudioSink {
        return this._sink;
    }

    public async mute(): Promise<void> {
        this._muted = true;
        await this._client.setMuted(true);
    }

    public async unmute(): Promise<void> {
        this._muted = false;
        await this._client.setMuted(false);
    }

    public isMuted(): boolean {
        return this._muted;
    }

    private _ensureAudio(participantId: string): ParticipantAudio {
        const existing: ParticipantAudio | undefined = this._audio.get(participantId);
        if (existing !== undefined) {
            return existing;
        }
        const audio: ParticipantAudio = {
            source: new PushAudioSource(`jitsi-${participantId}`),
            // Native rate is unknown until the first chunk; seed with the WebRTC
            // default (48 kHz) and rebuild if a track reports otherwise.
            resampler: new PcmResampler(48000, INTERNAL_AUDIO_FORMAT.sampleRate),
            assembler: new PcmFrameAssembler(20, participantId),
        };
        this._audio.set(participantId, audio);
        return audio;
    }

    private _onParticipantJoined(participant: JitsiParticipant): void {
        this._participants.set(participant.id, participant);
        this._listener?.onParticipantJoined({
            platformUserId: participant.id,
            displayName: participant.displayName,
        });
    }

    private _onParticipantLeft(participantId: string): void {
        this._participants.delete(participantId);
        const audio: ParticipantAudio | undefined = this._audio.get(participantId);
        if (audio !== undefined) {
            for (const frame of audio.assembler.flush(Date.now())) {
                audio.source.push(frame);
            }
            audio.source.close();
            this._audio.delete(participantId);
        }
        // A leaver who was the dominant speaker is no longer speaking.
        if (this._dominantSpeaker === participantId) {
            this._dominantSpeaker = null;
            this._listener?.onSpeakingChanged(participantId, false);
        }
        this._listener?.onParticipantLeft(participantId);
    }

    /**
     * Map Jitsi's single dominant speaker onto per-participant speaking state: the
     * previous speaker goes silent, the new one starts. Jitsi reports one speaker
     * at a time, which is exactly what drives the live "who's talking" indicator.
     */
    private _onDominantSpeaker(participantId: string | null): void {
        const previous: string | null = this._dominantSpeaker;
        if (previous === participantId) {
            return;
        }
        this._dominantSpeaker = participantId;
        if (previous !== null) {
            this._listener?.onSpeakingChanged(previous, false);
        }
        if (participantId !== null) {
            this._listener?.onSpeakingChanged(participantId, true);
        }
    }

    private _onAudioData(data: JitsiAudioData): void {
        try {
            const audio: ParticipantAudio = this._ensureAudio(data.participantId);
            if (data.sampleRate !== audio.resampler.inRate) {
                // Track renegotiated to a different rate — rebuild the resampler.
                audio.resampler = new PcmResampler(
                    data.sampleRate,
                    INTERNAL_AUDIO_FORMAT.sampleRate,
                );
            }
            const resampled: Int16Array = audio.resampler.process(data.samples);
            const frames = audio.assembler.push(resampled, Date.now());
            for (const frame of frames) {
                audio.source.push(frame);
            }
        } catch (error: unknown) {
            this._onError(`audio conversion failed: ${(error as Error).message}`);
        }
    }

    private _onError(message: string): void {
        Logger.getLogger().error(`JitsiAdapter: ${message}`);
        EventBus.getInstance().emit(AudioMeshEvent.ErrorOccurred, {
            component: 'JitsiAdapter',
            message: message,
        });
    }
}
