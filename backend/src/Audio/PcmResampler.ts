/**
 * Streaming linear-interpolation resampler for mono 16-bit PCM. Platform adapters
 * receive audio at the codec's native rate (WebRTC/Jitsi hand out 48 kHz, Discord
 * 48 kHz Opus, TeamSpeak 48 kHz) but the mesh runs at {@link INTERNAL_AUDIO_FORMAT}
 * (16 kHz). Each per-participant stream owns one instance so the fractional read
 * position carries across chunk boundaries — otherwise every chunk edge would
 * introduce a click.
 *
 * Linear interpolation is deliberately chosen over a poly-phase FIR: it is cheap,
 * allocation-light and more than good enough for speech STT, which is all the
 * internal format targets. Optimise only if profiling says so (project rule).
 */
export class PcmResampler {
    private readonly _inRate: number;
    private readonly _outRate: number;
    private readonly _ratio: number;

    /** Last input sample of the previous chunk, for cross-chunk interpolation. */
    private _prevSample: number = 0;
    private _hasPrev: boolean = false;
    /** Fractional read cursor into the current input chunk (0..1 relative to prev). */
    private _cursor: number = 0;

    public constructor(inRate: number, outRate: number) {
        if (inRate <= 0 || outRate <= 0) {
            throw new Error(`PcmResampler: rates must be positive (got ${inRate} -> ${outRate})`);
        }
        this._inRate = inRate;
        this._outRate = outRate;
        this._ratio = inRate / outRate;
    }

    public get inRate(): number {
        return this._inRate;
    }

    public get outRate(): number {
        return this._outRate;
    }

    /**
     * Resample one chunk. Returns the output samples produced from it; state is
     * retained so the next call continues seamlessly. A pass-through (equal rates)
     * returns a copy so callers may freely retain the buffer.
     */
    public process(input: Int16Array): Int16Array {
        if (input.length === 0) {
            return new Int16Array(0);
        }
        if (this._inRate === this._outRate) {
            return Int16Array.from(input);
        }

        const out: number[] = [];
        // `pos` is a floating index into a virtual stream where index -1 is the
        // previous chunk's last sample and index i is input[i].
        let pos: number = this._cursor;
        const step: number = this._ratio;

        while (pos < input.length) {
            const base: number = Math.floor(pos);
            const frac: number = pos - base;

            const left: number =
                base < 0
                    ? this._hasPrev
                        ? this._prevSample
                        : (input[0] as number)
                    : (input[base] as number);
            const right: number =
                base + 1 < input.length
                    ? (input[base + 1] as number)
                    : (input[input.length - 1] as number);

            out.push(Math.round(left + (right - left) * frac));
            pos += step;
        }

        // Carry the leftover fractional cursor into the next chunk's coordinate
        // space (shift by the chunk length just consumed).
        this._cursor = pos - input.length;
        this._prevSample = input[input.length - 1] as number;
        this._hasPrev = true;

        return Int16Array.from(out);
    }

    /** Reset stream state (e.g. when a participant's track restarts). */
    public reset(): void {
        this._prevSample = 0;
        this._hasPrev = false;
        this._cursor = 0;
    }
}
