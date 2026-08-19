import type { IAudioFrame } from './AudioFormat.js';

export type AudioFrameListener = (frame: IAudioFrame) => void;

/**
 * A streaming producer of audio frames. Adapters expose one per participant (or a
 * mixed one per channel); processors and transcription consume it. Push-based
 * (`onFrame`) so back-ends that receive audio on their own callbacks don't have
 * to fake a pull loop; `close()` releases the underlying resource.
 */
export interface IAudioSource {
    readonly id: string;
    onFrame(listener: AudioFrameListener): void;
    offFrame(listener: AudioFrameListener): void;
    close(): void;
}

/**
 * A streaming transform. `process` returns the (possibly modified) frame to pass
 * downstream, or `null` to drop it (e.g. VAD gating out silence). Must be cheap
 * and non-blocking — it runs on every frame.
 */
export interface IAudioProcessor {
    readonly id: string;
    process(frame: IAudioFrame): IAudioFrame | null;
}

/**
 * A streaming consumer of audio frames — another platform's send path, a
 * transcription feeder, a recorder. `write` must not block; slow sinks apply
 * backpressure / drop internally and surface overflow as an error event.
 */
export interface IAudioSink {
    readonly id: string;
    write(frame: IAudioFrame): void;
    close(): void;
}
