/**
 * Regularises an Int16 sample stream into fixed-size chunks. The outbound (send)
 * path needs this because WebRTC's `RTCAudioSource.onData` expects exactly one
 * 10 ms frame per call (e.g. 480 samples at 48 kHz) — but the mesh delivers audio
 * in its own 20 ms internal frames, and resampling changes the count again. The
 * chunker absorbs that mismatch, holding any remainder until the next push.
 *
 * This is the send-side analogue of {@link PcmFrameAssembler} (which produces
 * mesh `IAudioFrame`s); here we only need raw Int16 chunks, so it stays minimal.
 */
export class Int16Chunker {
    private readonly _size: number;
    private _pending: number[] = [];

    public constructor(size: number) {
        if (size <= 0) {
            throw new Error(`Int16Chunker: size must be positive (got ${size})`);
        }
        this._size = size;
    }

    public get size(): number {
        return this._size;
    }

    /** Append samples and return every full chunk now available. */
    public push(samples: Int16Array): Int16Array[] {
        for (const sample of samples) {
            this._pending.push(sample);
        }
        const chunks: Int16Array[] = [];
        while (this._pending.length >= this._size) {
            chunks.push(Int16Array.from(this._pending.splice(0, this._size)));
        }
        return chunks;
    }

    /** Emit the buffered remainder as one zero-padded chunk (e.g. on track end). */
    public flush(): Int16Array | null {
        if (this._pending.length === 0) {
            return null;
        }
        while (this._pending.length < this._size) {
            this._pending.push(0);
        }
        return Int16Array.from(this._pending.splice(0, this._size));
    }

    public reset(): void {
        this._pending = [];
    }
}
