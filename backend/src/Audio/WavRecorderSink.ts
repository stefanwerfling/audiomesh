import { Logger } from 'figtree';
import { INTERNAL_AUDIO_FORMAT, type IAudioFrame } from './AudioFormat.js';
import type { IAudioSink } from './IAudio.js';
import { WavWriter } from './WavWriter.js';

/**
 * An {@link IAudioSink} that persists the frames flowing through it to a WAV file
 * (opt-in recording). Dropped straight into a participant's pipeline in place of
 * the null sink when `privacy.recordingEnabled` is on. Fault-isolated: a disk
 * error disables further writes and is logged once, never thrown — a failed
 * recording must not tear down the live session (project rule).
 */
export class WavRecorderSink implements IAudioSink {
    public readonly id: string;
    private readonly _writer: WavWriter;
    private _failed: boolean = false;

    public constructor(id: string, filePath: string) {
        this.id = id;
        this._writer = new WavWriter(filePath, {
            sampleRate: INTERNAL_AUDIO_FORMAT.sampleRate,
            channels: INTERNAL_AUDIO_FORMAT.channels,
            bitsPerSample: INTERNAL_AUDIO_FORMAT.bytesPerSample * 8,
        });
    }

    public write(frame: IAudioFrame): void {
        if (this._failed) {
            return;
        }
        try {
            this._writer.write(frame.data);
        } catch (error: unknown) {
            this._failed = true;
            Logger.getLogger().error(
                `WavRecorderSink[${this.id}]: recording disabled after write error: ${(error as Error).message}`,
            );
        }
    }

    public close(): void {
        try {
            this._writer.close();
        } catch (error: unknown) {
            Logger.getLogger().warn(
                `WavRecorderSink[${this.id}]: close failed: ${(error as Error).message}`,
            );
        }
    }

    public get bytesWritten(): number {
        return this._writer.bytesWritten;
    }
}
