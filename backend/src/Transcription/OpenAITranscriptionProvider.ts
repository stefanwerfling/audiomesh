import { Logger } from 'figtree';
import { INTERNAL_AUDIO_FORMAT, type IAudioFrame } from '../Audio/AudioFormat.js';
import type { AudioFrameListener, IAudioSource } from '../Audio/IAudio.js';
import { int16FromPcmBuffer, pcmBufferFromInt16 } from '../Audio/PcmConvert.js';
import { PcmResampler } from '../Audio/PcmResampler.js';
import { EventBus } from '../Core/EventBus.js';
import { AudioMeshEvent } from '../Core/Events.js';
import type {
    IRealtimeTranscriptionSession,
    RealtimeTranscriptionSessionFactory,
} from './IRealtimeTranscriptionSession.js';
import { OpenAIRealtimeTranscriptionSession } from './OpenAIRealtimeTranscriptionSession.js';
import type { ITranscriptionProvider, TranscriptListener } from './ITranscriptionProvider.js';

/** Per-speaker transcription state the provider tracks. */
interface SpeakerStream {
    session: IRealtimeTranscriptionSession;
    source: IAudioSource;
    listener: AudioFrameListener;
    /** null when the session already runs at the internal rate (no resample). */
    resampler: PcmResampler | null;
}

/**
 * Streaming OpenAI speech-to-text. For each speaker it opens an
 * {@link IRealtimeTranscriptionSession}, subscribes to that participant's
 * {@link IAudioSource}, resamples the internal 16 kHz PCM up to whatever rate the
 * backend expects (OpenAI Realtime = 24 kHz) and forwards it, then maps the
 * session's partial/final results onto {@link TranscriptResult}.
 *
 * The WebSocket/OpenAI specifics live entirely behind the session seam; this class
 * is pure orchestration and is unit-tested with a fake session. Errors are logged
 * and emitted as `ErrorOccurred` — a transcription failure must never end the
 * session (fault-isolation rule).
 */
export class OpenAITranscriptionProvider implements ITranscriptionProvider {
    public readonly name: string = 'openai';

    private readonly _factory: RealtimeTranscriptionSessionFactory;
    private readonly _streams: Map<string, SpeakerStream> = new Map();

    public constructor(
        factory: RealtimeTranscriptionSessionFactory = (): IRealtimeTranscriptionSession =>
            new OpenAIRealtimeTranscriptionSession(),
    ) {
        this._factory = factory;
    }

    public async start(
        speakerId: string,
        source: IAudioSource,
        onResult: TranscriptListener,
    ): Promise<void> {
        if (this._streams.has(speakerId)) {
            return;
        }
        const session: IRealtimeTranscriptionSession = this._factory();
        const resampler: PcmResampler | null =
            session.inputSampleRate === INTERNAL_AUDIO_FORMAT.sampleRate
                ? null
                : new PcmResampler(INTERNAL_AUDIO_FORMAT.sampleRate, session.inputSampleRate);

        await session.open({
            onPartial: (text: string): void =>
                onResult({ speakerId: speakerId, text: text, final: false, timestamp: Date.now() }),
            onFinal: (text: string): void =>
                onResult({ speakerId: speakerId, text: text, final: true, timestamp: Date.now() }),
            onError: (message: string): void => this._onError(speakerId, message),
        });

        const listener: AudioFrameListener = (frame: IAudioFrame): void => {
            try {
                const pcm: Buffer =
                    resampler === null
                        ? frame.data
                        : pcmBufferFromInt16(resampler.process(int16FromPcmBuffer(frame.data)));
                session.sendAudio(pcm);
            } catch (error: unknown) {
                this._onError(speakerId, `feed failed: ${(error as Error).message}`);
            }
        };
        source.onFrame(listener);
        this._streams.set(speakerId, {
            session: session,
            source: source,
            listener: listener,
            resampler: resampler,
        });
    }

    public async stop(speakerId: string): Promise<void> {
        const stream: SpeakerStream | undefined = this._streams.get(speakerId);
        if (stream === undefined) {
            return;
        }
        this._streams.delete(speakerId);
        stream.source.offFrame(stream.listener);
        try {
            await stream.session.close();
        } catch (error: unknown) {
            Logger.getLogger().warn(
                `OpenAITranscriptionProvider: close(${speakerId}): ${(error as Error).message}`,
            );
        }
    }

    private _onError(speakerId: string, message: string): void {
        Logger.getLogger().error(`OpenAITranscriptionProvider[${speakerId}]: ${message}`);
        EventBus.getInstance().emit(AudioMeshEvent.ErrorOccurred, {
            component: 'OpenAITranscriptionProvider',
            message: `${speakerId}: ${message}`,
        });
    }
}
