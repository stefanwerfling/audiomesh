import type { IAudioFrame } from './AudioFormat.js';
import type { AudioFrameListener, IAudioSource } from './IAudio.js';

/**
 * A trivial push-based {@link IAudioSource}: whoever owns it calls {@link push}
 * with frames and every registered listener receives them. Used by adapters that
 * receive audio on their own callbacks (mock now, Discord later) and by tests.
 */
export class PushAudioSource implements IAudioSource {

    public readonly id: string;
    private readonly _listeners: Set<AudioFrameListener> = new Set();
    private _closed: boolean = false;

    public constructor(id: string) {
        this.id = id;
    }

    public onFrame(listener: AudioFrameListener): void {
        this._listeners.add(listener);
    }

    public offFrame(listener: AudioFrameListener): void {
        this._listeners.delete(listener);
    }

    public push(frame: IAudioFrame): void {
        if (this._closed) {
            return;
        }
        for (const listener of this._listeners) {
            listener(frame);
        }
    }

    public isClosed(): boolean {
        return this._closed;
    }

    public close(): void {
        this._closed = true;
        this._listeners.clear();
    }

}
