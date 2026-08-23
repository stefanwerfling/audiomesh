import type { PlatformKind } from '@audiomesh/schemas';
import { Logger } from 'figtree';
import { INTERNAL_AUDIO_FORMAT } from '../../../Audio/AudioFormat.js';
import type { IAudioSink, IAudioSource } from '../../../Audio/IAudio.js';
import { PcmFrameAssembler } from '../../../Audio/PcmFrameAssembler.js';
import { PcmResampler } from '../../../Audio/PcmResampler.js';
import { PushAudioSource } from '../../../Audio/PushAudioSource.js';
import { ResamplingSendSink } from '../../../Audio/ResamplingSendSink.js';
import { EventBus } from '../../../Core/EventBus.js';
import { AudioMeshEvent } from '../../../Core/Events.js';
import type {
    AdapterConfig,
    IAdapterEventListener,
    IChannelInfo,
    IParticipantInfo,
    IVoicePlatformAdapter,
} from '../../IVoicePlatformAdapter.js';
import type {
    ITeamSpeakClient,
    TeamSpeakAudioData,
    TeamSpeakParticipant,
} from './ITeamSpeakClient.js';
import { parseTeamSpeakConfig, type TeamSpeakConfig } from './TeamSpeakConfig.js';

/** TS3's native voice sample rate (Opus Voice / Music are 48 kHz mono). */
const TS3_VOICE_RATE: number = 48000;

/** Per-participant receive state: the mesh source plus its conversion chain. */
interface ParticipantAudio {
    source: PushAudioSource;
    resampler: PcmResampler;
    assembler: PcmFrameAssembler;
}

/** Factory the adapter uses to build its client — swapped for a fake in tests. */
export type TeamSpeakClientFactory = (config: TeamSpeakConfig) => ITeamSpeakClient;

/**
 * TeamSpeak 3 voice platform adapter. A headless bot joins a TS3 server over our
 * own native implementation of the TS3 UDP voice protocol, receives each remote
 * client's Opus voice decoded to 48 kHz Int16 PCM, and republishes it as
 * internal-format {@link IAudioSource}s the mesh can transcribe and route.
 *
 * All TS3/UDP/crypto/Opus specifics live behind {@link ITeamSpeakClient}; this
 * class only maps that transport onto the {@link IVoicePlatformAdapter} contract —
 * channels, participants, per-participant sources, mute — and converts audio into
 * the canonical mesh format. Errors from the client become `ErrorOccurred` events
 * and are never thrown up into the Core (fault-isolation rule).
 *
 * Unlike Jitsi, TS3 exposes a real server-side channel directory ({@link
 * getChannels} enumerates it) and reports talk start/stop per client, so speaking
 * state maps one-to-one rather than through a single dominant speaker.
 *
 * The outbound send path uses {@link ResamplingSendSink} — a codec-agnostic sink
 * that resamples internal 16 kHz frames up to the client's send rate and gates on
 * mute.
 */
export class TeamSpeakAdapter implements IVoicePlatformAdapter {
    public readonly kind: PlatformKind = 'teamspeak';

    private readonly _config: TeamSpeakConfig;
    private readonly _client: ITeamSpeakClient;

    private readonly _participants: Map<string, TeamSpeakParticipant> = new Map();
    private readonly _audio: Map<string, ParticipantAudio> = new Map();
    private readonly _sink: ResamplingSendSink;

    private _connected: boolean = false;
    private _joinedChannel: string | null = null;
    private _muted: boolean;
    private _listener: IAdapterEventListener | null = null;

    public constructor(config: AdapterConfig, clientFactory: TeamSpeakClientFactory) {
        this._config = parseTeamSpeakConfig(config);
        this._client = clientFactory(this._config);
        this._muted = this._config.startMuted;
        this._sink = new ResamplingSendSink(
            'teamspeak-out',
            this._client.getSendSampleRate(),
            (): boolean => this._muted,
            (samples: Int16Array, sampleRate: number): void =>
                this._client.sendAudio(samples, sampleRate),
        );
        this._client.setHandlers({
            onParticipantJoined: (p: TeamSpeakParticipant): void => this._onParticipantJoined(p),
            onParticipantLeft: (id: string): void => this._onParticipantLeft(id),
            onAudioData: (data: TeamSpeakAudioData): void => this._onAudioData(data),
            onSpeakingChanged: (id: string, speaking: boolean): void =>
                this._listener?.onSpeakingChanged(id, speaking),
            onError: (message: string): void => this._onError(message),
        });
    }

    public setEventListener(listener: IAdapterEventListener | null): void {
        this._listener = listener;
    }

    public async connect(): Promise<void> {
        await this._client.connect();
        this._connected = this._client.isConnected();
        if (this._connected && this._config.defaultChannelId !== undefined) {
            await this.joinChannel(this._config.defaultChannelId);
        }
    }

    public async disconnect(): Promise<void> {
        try {
            await this._client.disconnect();
        } finally {
            this._connected = false;
            this._joinedChannel = null;
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
        return this._client.getChannels();
    }

    public async joinChannel(channelId: string): Promise<IChannelInfo> {
        if (channelId.trim().length === 0) {
            throw new Error('TeamSpeakAdapter: channelId must not be empty');
        }
        await this._client.joinChannel(channelId);
        this._joinedChannel = channelId;
        // Seed the participant snapshot the client already knows about.
        this._participants.clear();
        for (const p of this._client.getParticipants()) {
            this._participants.set(p.id, p);
        }
        if (this._config.startMuted) {
            await this._client.setMuted(true);
        }
        const channels: IChannelInfo[] = await this._client.getChannels();
        const match: IChannelInfo | undefined = channels.find(
            (c: IChannelInfo): boolean => c.id === channelId,
        );
        return match ?? { id: channelId, name: channelId };
    }

    public async leaveChannel(): Promise<void> {
        // TS3 has no "leave to nowhere" — a client is always in some channel. The
        // session is torn down by disconnect(); here we just drop the local marker.
        this._joinedChannel = null;
    }

    public async getParticipants(): Promise<IParticipantInfo[]> {
        return [...this._participants.values()].map(
            (p: TeamSpeakParticipant): IParticipantInfo => ({
                platformUserId: p.id,
                displayName: p.displayName,
            }),
        );
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
            source: new PushAudioSource(`teamspeak-${participantId}`),
            resampler: new PcmResampler(TS3_VOICE_RATE, INTERNAL_AUDIO_FORMAT.sampleRate),
            assembler: new PcmFrameAssembler(20, participantId),
        };
        this._audio.set(participantId, audio);
        return audio;
    }

    private _onParticipantJoined(participant: TeamSpeakParticipant): void {
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
        this._listener?.onParticipantLeft(participantId);
    }

    private _onAudioData(data: TeamSpeakAudioData): void {
        try {
            const audio: ParticipantAudio = this._ensureAudio(data.participantId);
            if (data.sampleRate !== audio.resampler.inRate) {
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
        Logger.getLogger().error(`TeamSpeakAdapter: ${message}`);
        EventBus.getInstance().emit(AudioMeshEvent.ErrorOccurred, {
            component: 'TeamSpeakAdapter',
            message: message,
        });
    }
}
