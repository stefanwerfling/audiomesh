import WebSocket, { type RawData } from 'ws';
import { Logger } from 'figtree';
import { ConfigStore } from '../Store/ConfigStore.js';
import type {
    IRealtimeTranscriptionSession,
    RealtimeTranscriptionHandlers,
} from './IRealtimeTranscriptionSession.js';

/** OpenAI Realtime input audio is 24 kHz mono s16le PCM. */
const OPENAI_INPUT_SAMPLE_RATE: number = 24000;

/** Build the Realtime WS URL from the configured (http/https) API base. */
function realtimeUrl(): string {
    const base: string = ConfigStore.getInstance().getOpenAiBaseUrl();
    const wsBase: string = base.replace(/^http/, 'ws');
    return `${wsBase}/v1/realtime?intent=transcription`;
}

/**
 * Real {@link IRealtimeTranscriptionSession} over OpenAI's Realtime transcription
 * WebSocket. Opens the socket with the backend-only API key, configures a
 * server-VAD transcription session, streams appended PCM and translates the
 * server events into partial/final callbacks:
 *
 *   `conversation.item.input_audio_transcription.delta`     → onPartial
 *   `conversation.item.input_audio_transcription.completed` → onFinal
 *   `error`                                                 → onError
 *
 * The key is read from {@link ConfigStore} and never leaves the backend. `ws` is
 * already a backend dependency, so no lazy-import dance is needed — but the class
 * still sits behind the session seam so the provider is testable without a socket.
 */
export class OpenAIRealtimeTranscriptionSession implements IRealtimeTranscriptionSession {
    public readonly inputSampleRate: number = OPENAI_INPUT_SAMPLE_RATE;

    private _ws: WebSocket | null = null;
    private _handlers: RealtimeTranscriptionHandlers | null = null;

    public async open(handlers: RealtimeTranscriptionHandlers): Promise<void> {
        this._handlers = handlers;
        const apiKey: string = ConfigStore.getInstance().getOpenAiKey();
        if (apiKey.length === 0) {
            throw new Error('OpenAI API key not configured');
        }
        const model: string =
            ConfigStore.getInstance().getSettings().openai.transcriptionModel ||
            'gpt-4o-transcribe';

        await new Promise<void>((resolve, reject): void => {
            const ws: WebSocket = new WebSocket(realtimeUrl(), {
                headers: {
                    Authorization: `Bearer ${apiKey}`,
                    'OpenAI-Beta': 'realtime=v1',
                },
            });
            this._ws = ws;

            ws.on('open', (): void => {
                ws.send(
                    JSON.stringify({
                        type: 'transcription_session.update',
                        session: {
                            input_audio_format: 'pcm16',
                            input_audio_transcription: { model: model },
                            turn_detection: { type: 'server_vad' },
                        },
                    }),
                );
                resolve();
            });
            ws.on('message', (data: RawData): void => this._onMessage(data));
            ws.on('error', (error: Error): void => {
                this._handlers?.onError(`websocket error: ${error.message}`);
                reject(error);
            });
            ws.on('close', (): void => {
                this._ws = null;
            });
        });
    }

    public sendAudio(pcm16: Buffer): void {
        const ws: WebSocket | null = this._ws;
        if (ws === null || ws.readyState !== WebSocket.OPEN) {
            return;
        }
        ws.send(
            JSON.stringify({
                type: 'input_audio_buffer.append',
                audio: pcm16.toString('base64'),
            }),
        );
    }

    public async close(): Promise<void> {
        const ws: WebSocket | null = this._ws;
        this._ws = null;
        this._handlers = null;
        if (ws !== null && ws.readyState === WebSocket.OPEN) {
            ws.close();
        }
    }

    private _onMessage(data: RawData): void {
        let event: Record<string, unknown>;
        try {
            event = JSON.parse(data.toString()) as Record<string, unknown>;
        } catch (error: unknown) {
            Logger.getLogger().warn(
                `OpenAIRealtimeTranscriptionSession: bad event: ${(error as Error).message}`,
            );
            return;
        }
        const type: unknown = event['type'];
        if (type === 'conversation.item.input_audio_transcription.delta') {
            const delta: unknown = event['delta'];
            if (typeof delta === 'string' && delta.length > 0) {
                this._handlers?.onPartial(delta);
            }
        } else if (type === 'conversation.item.input_audio_transcription.completed') {
            const transcript: unknown = event['transcript'];
            if (typeof transcript === 'string') {
                this._handlers?.onFinal(transcript);
            }
        } else if (type === 'error') {
            const err: unknown = event['error'];
            const message: string =
                err !== null &&
                typeof err === 'object' &&
                typeof (err as Record<string, unknown>)['message'] === 'string'
                    ? ((err as Record<string, unknown>)['message'] as string)
                    : 'unknown realtime error';
            this._handlers?.onError(message);
        }
    }
}
