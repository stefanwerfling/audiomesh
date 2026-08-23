import type { Buffer } from 'node:buffer';

/**
 * Per-sender voice jitter/reorder buffer (`../PROTOCOL.md` §6.1, §6.4). UDP voice
 * is fire-and-forget: frames can arrive out of order, duplicated, or not at all.
 * Keyed on the payload's u16 `voiceCounter`, this buffer emits frames **in order**,
 * drops late/duplicate ones, and — when a gap stalls too long — skips the lost
 * frame so playback recovers instead of freezing.
 *
 * The u16 counter wraps `0xffff → 0`, so ordering uses a signed 16-bit distance
 * ({@link u16Diff}) rather than plain `<`. An empty codec frame is the talk-stop
 * marker: it flushes any held frames, emits a {@link VoiceTalkStopEvent}, and
 * resets the buffer so the next talk spurt re-seeds cleanly (the receiver is
 * expected to flush its jitter buffer on end-of-talk).
 *
 * One instance per speaker; feed decoded voice payloads with {@link push}. Purely
 * counter-driven (no wall clock) so tests are deterministic.
 */

/** Signed 16-bit distance `a - b`, wrapped to `[-32768, 32767]` (handles u16 wrap). */
export function u16Diff(a: number, b: number): number {
    let d: number = (a - b) & 0xffff;
    if (d >= 0x8000) {
        d -= 0x10000;
    }
    return d;
}

/** An ordered voice frame ready to hand to the Opus decoder. */
export interface VoiceFrameEvent {
    type: 'frame';
    voiceCounter: number;
    frame: Buffer;
}

/** End-of-talk: the sender's empty frame flushed the buffer; stop playback. */
export interface VoiceTalkStopEvent {
    type: 'talk-stop';
}

export type VoiceEvent = VoiceFrameEvent | VoiceTalkStopEvent;

/** Held frames beyond this force a skip-ahead so a lost packet cannot freeze playback. */
export const DEFAULT_MAX_BUFFERED: number = 10;

export class VoiceReorderBuffer {
    private readonly _maxBuffered: number;
    private _expected: number | null = null;
    private readonly _pending: Map<number, Buffer> = new Map<number, Buffer>();

    public constructor(options: { maxBuffered?: number } = {}) {
        this._maxBuffered = options.maxBuffered ?? DEFAULT_MAX_BUFFERED;
    }

    /**
     * Feed one decoded voice payload. Returns the frames this call unblocks, in
     * counter order — usually one, more when it fills a gap, none while still
     * waiting for a missing frame, or a single talk-stop on an empty frame.
     */
    public push(voiceCounter: number, frame: Buffer): VoiceEvent[] {
        const events: VoiceEvent[] = [];

        // Talk-stop marker (§6.4): flush held frames in order, then stop + reset.
        if (frame.length === 0) {
            this._drainAll(events);
            events.push({ type: 'talk-stop' });
            this._reset();
            return events;
        }

        const counter: number = voiceCounter & 0xffff;
        if (this._expected === null) {
            this._expected = counter;
        }

        const diff: number = u16Diff(counter, this._expected);
        if (diff < 0) {
            // Already emitted (late or duplicate) — drop.
            return events;
        }

        this._pending.set(counter, frame);

        // Waited too long for a missing frame: give up on it and skip to the
        // oldest held frame so we recover instead of freezing.
        if (this._pending.size > this._maxBuffered) {
            this._expected = this._oldestPending();
        }

        this._drainConsecutive(events);
        return events;
    }

    /** True while frames are held waiting for an earlier one to arrive. */
    public get buffered(): number {
        return this._pending.size;
    }

    /** Emit every consecutive frame starting at `_expected`, advancing as it goes. */
    private _drainConsecutive(events: VoiceEvent[]): void {
        if (this._expected === null) {
            return;
        }
        let next: Buffer | undefined = this._pending.get(this._expected);
        while (next !== undefined) {
            this._pending.delete(this._expected);
            events.push({ type: 'frame', voiceCounter: this._expected, frame: next });
            this._expected = (this._expected + 1) & 0xffff;
            next = this._pending.get(this._expected);
        }
    }

    /** Emit all held frames in ascending counter order (used on talk-stop). */
    private _drainAll(events: VoiceEvent[]): void {
        if (this._expected === null || this._pending.size === 0) {
            return;
        }
        const ordered: number[] = [...this._pending.keys()].sort(
            (a: number, b: number): number =>
                u16Diff(a, this._expected!) - u16Diff(b, this._expected!),
        );
        for (const key of ordered) {
            events.push({ type: 'frame', voiceCounter: key, frame: this._pending.get(key)! });
        }
        this._pending.clear();
    }

    /** The held counter closest to `_expected` (smallest forward distance). */
    private _oldestPending(): number {
        let oldest: number | null = null;
        let bestDistance: number = Number.POSITIVE_INFINITY;
        for (const key of this._pending.keys()) {
            const distance: number = u16Diff(key, this._expected!);
            if (distance < bestDistance) {
                bestDistance = distance;
                oldest = key;
            }
        }
        return oldest ?? this._expected!;
    }

    private _reset(): void {
        this._expected = null;
        this._pending.clear();
    }
}
