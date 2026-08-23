/**
 * The outbound voice spurt counter (`../PROTOCOL.md` §6.1). Every voice packet we
 * send carries a u16 that increments by one per packet and is **separate from the
 * reliability packet-id counters** (`../reliability/PacketCounter`): it orders a
 * talk spurt's frames for the receiver's jitter buffer, and — unlike a packet id —
 * it is never acked and has no generation counter. It simply wraps `0xffff → 0`.
 *
 * Clock-free and side-effect-free so the send path stays deterministic under test.
 */
export class VoiceCounter {
    private _value: number;

    public constructor(start: number = 0) {
        this._value = start & 0xffff;
    }

    /** Return the current counter, then advance (post-increment, u16 wrap). */
    public next(): number {
        const current: number = this._value;
        this._value = (this._value + 1) & 0xffff;
        return current;
    }

    /** The value the next {@link next} call will return, without advancing. */
    public peek(): number {
        return this._value;
    }

    /** Reset the counter (e.g. on reconnect). */
    public reset(start: number = 0): void {
        this._value = start & 0xffff;
    }
}
