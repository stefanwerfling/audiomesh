import type {
    IRealtimeTranscriptionSession,
    RealtimeTranscriptionHandlers,
} from '../../src/Transcription/IRealtimeTranscriptionSession.js';

/**
 * In-memory {@link IRealtimeTranscriptionSession} for testing the provider and
 * the manager's transcription wiring without a WebSocket. Tests drive results via
 * `emit*`, exactly as the real OpenAI socket would off its server events.
 */
export class FakeTranscriptionSession implements IRealtimeTranscriptionSession {
    public readonly inputSampleRate: number;
    public handlers: RealtimeTranscriptionHandlers | null = null;
    public readonly sent: Buffer[] = [];
    public opened: boolean = false;
    public closed: boolean = false;

    public constructor(inputSampleRate: number = 24000) {
        this.inputSampleRate = inputSampleRate;
    }

    public async open(handlers: RealtimeTranscriptionHandlers): Promise<void> {
        this.handlers = handlers;
        this.opened = true;
    }

    public sendAudio(pcm16: Buffer): void {
        if (!this.closed) {
            this.sent.push(pcm16);
        }
    }

    public async close(): Promise<void> {
        this.closed = true;
    }

    public emitPartial(text: string): void {
        this.handlers?.onPartial(text);
    }

    public emitFinal(text: string): void {
        this.handlers?.onFinal(text);
    }

    public emitError(message: string): void {
        this.handlers?.onError(message);
    }
}
