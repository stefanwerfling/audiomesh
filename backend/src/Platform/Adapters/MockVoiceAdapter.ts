import type { PlatformKind } from '@audiomesh/schemas';
import { INTERNAL_AUDIO_FORMAT, type IAudioFrame } from '../../Audio/AudioFormat.js';
import type { IAudioSink, IAudioSource } from '../../Audio/IAudio.js';
import { NullAudioSink } from '../../Audio/NullAudioSink.js';
import { PushAudioSource } from '../../Audio/PushAudioSource.js';
import type {
    AdapterConfig,
    IAdapterEventListener,
    IChannelInfo,
    IParticipantInfo,
    IVoicePlatformAdapter,
} from '../IVoicePlatformAdapter.js';

/**
 * A fully in-process adapter with no external dependency. It fabricates a couple
 * of channels and participants and emits synthetic PCM frames on a timer, so the
 * whole Core (sessions, pipeline, routing, WS) can be exercised — and tested —
 * without Discord/TeamSpeak/Jitsi. This is what makes "the Core must be testable
 * without a real voice platform" true.
 */
export class MockVoiceAdapter implements IVoicePlatformAdapter {
    public readonly kind: PlatformKind = 'mock';

    private static readonly FRAME_MS: number = 20;

    private readonly _channels: IChannelInfo[];
    private readonly _participants: IParticipantInfo[];
    private readonly _sources: Map<string, PushAudioSource> = new Map();
    private readonly _sink: NullAudioSink = new NullAudioSink('mock-out');
    private readonly _timers: Set<NodeJS.Timeout> = new Set();
    private _connected: boolean = false;

    public constructor(_config: AdapterConfig) {
        this._channels = [
            { id: 'general', name: 'General' },
            { id: 'meeting', name: 'Meeting Room' },
        ];
        this._participants = [
            { platformUserId: 'u-stefan', displayName: 'Stefan' },
            { platformUserId: 'u-max', displayName: 'Max' },
            { platformUserId: 'u-julia', displayName: 'Julia' },
        ];
    }

    public async connect(): Promise<void> {
        this._connected = true;
    }

    public async disconnect(): Promise<void> {
        this._connected = false;
        for (const timer of this._timers) {
            clearInterval(timer);
        }
        this._timers.clear();
        for (const source of this._sources.values()) {
            source.close();
        }
        this._sources.clear();
    }

    public isConnected(): boolean {
        return this._connected;
    }

    public async getChannels(): Promise<IChannelInfo[]> {
        return this._channels;
    }

    public async joinChannel(channelId: string): Promise<IChannelInfo> {
        const channel: IChannelInfo | undefined = this._channels.find(
            (c: IChannelInfo): boolean => c.id === channelId,
        );
        if (channel === undefined) {
            throw new Error(`MockVoiceAdapter: unknown channel '${channelId}'`);
        }
        return channel;
    }

    public async leaveChannel(): Promise<void> {
        // no channel-scoped state to release in the mock
    }

    public async getParticipants(): Promise<IParticipantInfo[]> {
        return this._participants;
    }

    public setEventListener(_listener: IAdapterEventListener | null): void {
        // The mock has a fixed roster and no live membership/speaking events.
    }

    public receiveAudio(participantId: string): IAudioSource {
        const existing: PushAudioSource | undefined = this._sources.get(participantId);
        if (existing !== undefined) {
            return existing;
        }
        const source: PushAudioSource = new PushAudioSource(`mock-${participantId}`);
        this._sources.set(participantId, source);
        // Emit a synthetic 20 ms PCM frame on a loop. Content is a low-amplitude
        // sine so downstream DSP/VAD has something non-zero to chew on.
        const samples: number =
            (INTERNAL_AUDIO_FORMAT.sampleRate * MockVoiceAdapter.FRAME_MS) / 1000;
        const timer: NodeJS.Timeout = setInterval((): void => {
            source.push(this._synthFrame(samples, participantId));
        }, MockVoiceAdapter.FRAME_MS);
        this._timers.add(timer);
        return source;
    }

    public sendAudio(): IAudioSink {
        return this._sink;
    }

    public async mute(): Promise<void> {
        // no-op in the mock
    }

    public async unmute(): Promise<void> {
        // no-op in the mock
    }

    private _synthFrame(samples: number, speakerId: string): IAudioFrame {
        const buffer: Buffer = Buffer.alloc(samples * INTERNAL_AUDIO_FORMAT.bytesPerSample);
        for (let i: number = 0; i < samples; i++) {
            const value: number = Math.round(Math.sin(i / 8) * 2000);
            buffer.writeInt16LE(value, i * INTERNAL_AUDIO_FORMAT.bytesPerSample);
        }
        return {
            data: buffer,
            timestamp: Date.now(),
            sampleRate: INTERNAL_AUDIO_FORMAT.sampleRate,
            channels: INTERNAL_AUDIO_FORMAT.channels,
            speakerId: speakerId,
        };
    }
}
