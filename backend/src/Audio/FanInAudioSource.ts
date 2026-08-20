import type { IAudioFrame } from './AudioFormat.js';
import type { AudioFrameListener, IAudioSource } from './IAudio.js';

/**
 * Combines several {@link IAudioSource}s into one: every frame from any input is
 * re-emitted to this source's listeners. Used to route a whole session's audio
 * (all its per-participant sources) into a single downstream chain.
 *
 * This is a *tap*, not an owner — {@link close} only unsubscribes from the inputs,
 * it never closes them (the session still owns its participant sources). Frames
 * are forwarded as-is, interleaved by arrival; true sample-summing mixing is a
 * later refinement, not needed to move audio across platforms.
 */
export class FanInAudioSource implements IAudioSource {
    public readonly id: string;

    private readonly _inputs: IAudioSource[];
    private readonly _listeners: Set<AudioFrameListener> = new Set();
    private readonly _tap: AudioFrameListener;
    private _closed: boolean = false;

    public constructor(id: string, inputs: IAudioSource[]) {
        this.id = id;
        this._inputs = inputs;
        this._tap = (frame: IAudioFrame): void => {
            if (this._closed) {
                return;
            }
            for (const listener of this._listeners) {
                listener(frame);
            }
        };
        for (const input of inputs) {
            input.onFrame(this._tap);
        }
    }

    public onFrame(listener: AudioFrameListener): void {
        this._listeners.add(listener);
    }

    public offFrame(listener: AudioFrameListener): void {
        this._listeners.delete(listener);
    }

    public close(): void {
        this._closed = true;
        for (const input of this._inputs) {
            input.offFrame(this._tap);
        }
        this._listeners.clear();
    }
}
