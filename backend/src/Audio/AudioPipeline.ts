import { Logger } from 'figtree';
import type { IAudioFrame } from './AudioFormat.js';
import type { AudioFrameListener, IAudioProcessor, IAudioSink, IAudioSource } from './IAudio.js';

/**
 * Wires one {@link IAudioSource} through an ordered list of {@link IAudioProcessor}s
 * into one {@link IAudioSink}. Streaming: each incoming frame is pushed through
 * the chain synchronously as it arrives — no buffering of whole utterances.
 *
 * Fault isolation: a throwing processor/sink is caught per frame and logged; the
 * pipeline keeps running so a single bad frame never tears down the session.
 */
export class AudioPipeline {

    private readonly _source: IAudioSource;
    private readonly _processors: IAudioProcessor[];
    private readonly _sink: IAudioSink;
    private readonly _listener: AudioFrameListener;
    private _running: boolean = false;

    public constructor(source: IAudioSource, processors: IAudioProcessor[], sink: IAudioSink) {
        this._source = source;
        this._processors = processors;
        this._sink = sink;
        this._listener = (frame: IAudioFrame): void => this._onFrame(frame);
    }

    public start(): void {
        if (this._running) {
            return;
        }
        this._running = true;
        this._source.onFrame(this._listener);
    }

    public stop(): void {
        if (!this._running) {
            return;
        }
        this._running = false;
        this._source.offFrame(this._listener);
    }

    private _onFrame(frame: IAudioFrame): void {
        try {
            let current: IAudioFrame | null = frame;
            for (const processor of this._processors) {
                if (current === null) {
                    return;
                }
                current = processor.process(current);
            }
            if (current !== null) {
                this._sink.write(current);
            }
        } catch (error: unknown) {
            Logger.getLogger().error(`AudioPipeline: frame dropped: ${(error as Error).message}`);
        }
    }

}
