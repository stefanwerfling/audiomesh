import type { IAudioFrame } from './AudioFormat.js';
import type { IAudioSink } from './IAudio.js';

/**
 * A sink that counts frames and discards them. Used as the outbound target for
 * adapters that don't (yet) play audio back, and as a stand-in in tests. `count`
 * lets a caller assert throughput without wiring a real consumer.
 */
export class NullAudioSink implements IAudioSink {

    public readonly id: string;
    private _count: number = 0;

    public constructor(id: string) {
        this.id = id;
    }

    public write(_frame: IAudioFrame): void {
        this._count++;
    }

    public getCount(): number {
        return this._count;
    }

    public close(): void {
        // nothing to release
    }

}
