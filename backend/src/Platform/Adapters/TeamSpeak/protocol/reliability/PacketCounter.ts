/**
 * Per-(direction, packet type) packet-id and generation counters
 * (`../PROTOCOL.md` §2.4). Each type has its own u16 id that starts at 1 and
 * increments by 1 per packet (each fragment counts); on the 65535→0 wrap a u32
 * generation counter increments and applies to the wrapping packet (id 0). The
 * generation is never on the wire — it feeds the per-packet key/nonce derivation,
 * so sender and receiver must track it identically.
 */

/** One more than the largest u16 packet id — the wrap modulus. */
export const PACKET_ID_WRAP: number = 0x10000;

export interface PacketCount {
    packetId: number;
    generationId: number;
}

/**
 * Outgoing counter for a single packet type. Deterministic: {@link next} returns
 * the id/generation to stamp on the packet being sent, then advances.
 */
export class OutgoingPacketCounter {
    private _id: number;
    private _generation: number;

    /** `startId` defaults to 1 (TS3's first regular packet id). */
    public constructor(startId: number = 1) {
        this._id = startId & 0xffff;
        this._generation = 0;
    }

    /** The id/generation the next {@link next} will hand out, without advancing. */
    public peek(): PacketCount {
        return { packetId: this._id, generationId: this._generation };
    }

    /** Return the current id/generation for this packet, then advance the counter. */
    public next(): PacketCount {
        const current: PacketCount = { packetId: this._id, generationId: this._generation };
        if (this._id >= 0xffff) {
            this._id = 0;
            this._generation = (this._generation + 1) >>> 0;
        } else {
            this._id += 1;
        }
        return current;
    }

    public get generation(): number {
        return this._generation;
    }
}

/**
 * Incoming generation tracker for a single packet type. UDP packet ids arrive
 * (mostly) in order and wrap at 65535; this reconstructs the implicit generation
 * for a received id using half-range wrap detection.
 *
 * Limitation (see `../PROTOCOL.md` risk #4): heavy reordering *across* the wrap
 * boundary can misattribute a packet's generation. A fully reorder-tolerant window
 * (à la TSLib's GenerationWindow) is a follow-up.
 */
export class IncomingGenerationTracker {
    private _generation: number = 0;
    private _lastId: number = -1;

    /** Reset to the pre-connection state. */
    public reset(): void {
        this._generation = 0;
        this._lastId = -1;
    }

    /** The generation a just-received `packetId` belongs to, advancing on wrap. */
    public generationFor(packetId: number): number {
        const id: number = packetId & 0xffff;
        if (this._lastId < 0) {
            this._lastId = id;
            return this._generation;
        }
        const forwardDistance: number = (id - this._lastId) & 0xffff;
        if (forwardDistance < 0x8000) {
            // Forward progress; a numerically smaller id means we crossed the wrap.
            if (id < this._lastId) {
                this._generation += 1;
            }
            this._lastId = id;
            return this._generation;
        }
        // Reordered/older packet: belongs before _lastId. If it is numerically
        // larger than _lastId it is a straggler from the previous generation.
        if (id > this._lastId && this._generation > 0) {
            return this._generation - 1;
        }
        return this._generation;
    }

    public get generation(): number {
        return this._generation;
    }
}
