import type { Buffer } from 'node:buffer';

/**
 * Reliable-send tracking for one packet-id space (Command *or* CommandLow —
 * `../PROTOCOL.md` §2.3/§7). TS3 commands must be held until the matching
 * Ack/AckLow arrives and retransmitted on timeout, giving up after ~30 s.
 *
 * This owns **no real timers** — the client's run-loop drives time by calling
 * {@link dueForResend} and {@link timedOut} with the current clock. That keeps
 * retransmission deterministic and unit-testable, and puts scheduling policy in
 * one place (the loop) rather than scattered across timer callbacks.
 */

/** A sent-but-unacked packet awaiting its Ack. */
interface PendingPacket {
    packetId: number;
    /** The full encoded wire bytes to resend verbatim. */
    wire: Buffer;
    firstSentAt: number;
    lastSentAt: number;
    attempts: number;
}

export interface ResendItem {
    packetId: number;
    wire: Buffer;
    attempts: number;
}

export class AckQueue {
    private readonly _pending: Map<number, PendingPacket> = new Map();
    private readonly _resendIntervalMs: number;
    private readonly _giveUpMs: number;

    public constructor(resendIntervalMs: number = 500, giveUpMs: number = 30_000) {
        this._resendIntervalMs = resendIntervalMs;
        this._giveUpMs = giveUpMs;
    }

    /** Record a reliable packet as sent; it stays pending until {@link ack}. */
    public track(packetId: number, wire: Buffer, nowMs: number): void {
        this._pending.set(packetId, {
            packetId: packetId,
            wire: wire,
            firstSentAt: nowMs,
            lastSentAt: nowMs,
            attempts: 1,
        });
    }

    /** Acknowledge a packet id. Returns true if it was actually pending. */
    public ack(packetId: number): boolean {
        return this._pending.delete(packetId);
    }

    /**
     * Packets whose resend interval has elapsed. Each returned item's `lastSentAt`
     * is advanced to `nowMs` and its attempt count bumped, so a caller that
     * actually resends won't be handed the same packet again until the next
     * interval. Ordered by packet id for deterministic resends.
     */
    public dueForResend(nowMs: number): ResendItem[] {
        const due: ResendItem[] = [];
        for (const pending of this._pending.values()) {
            if (nowMs - pending.lastSentAt >= this._resendIntervalMs) {
                pending.lastSentAt = nowMs;
                pending.attempts += 1;
                due.push({
                    packetId: pending.packetId,
                    wire: pending.wire,
                    attempts: pending.attempts,
                });
            }
        }
        due.sort((a: ResendItem, b: ResendItem): number => a.packetId - b.packetId);
        return due;
    }

    /** Packet ids that have been pending longer than the give-up window. */
    public timedOut(nowMs: number): number[] {
        const dead: number[] = [];
        for (const pending of this._pending.values()) {
            if (nowMs - pending.firstSentAt >= this._giveUpMs) {
                dead.push(pending.packetId);
            }
        }
        return dead;
    }

    public get pendingCount(): number {
        return this._pending.size;
    }

    public clear(): void {
        this._pending.clear();
    }
}
