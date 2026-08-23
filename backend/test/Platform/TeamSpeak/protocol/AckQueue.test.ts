import { Buffer } from 'node:buffer';
import { describe, expect, it } from 'vitest';
import { AckQueue } from '../../../../src/Platform/Adapters/TeamSpeak/protocol/reliability/AckQueue.js';

const wire = (n: number): Buffer => Buffer.from([n]);

describe('AckQueue', () => {
    it('tracks and acks packets', () => {
        const q: AckQueue = new AckQueue();
        q.track(1, wire(1), 0);
        q.track(2, wire(2), 0);
        expect(q.pendingCount).toBe(2);
        expect(q.ack(1)).toBe(true);
        expect(q.ack(1)).toBe(false); // already gone
        expect(q.pendingCount).toBe(1);
    });

    it('does not resend before the interval elapses, then resends once per interval', () => {
        const q: AckQueue = new AckQueue(500, 30_000);
        q.track(1, wire(1), 0);
        expect(q.dueForResend(499)).toEqual([]);

        const due = q.dueForResend(500);
        expect(due.map((d) => d.packetId)).toEqual([1]);
        expect(due[0]?.attempts).toBe(2);
        // Same interval window: not due again until another 500 ms.
        expect(q.dueForResend(700)).toEqual([]);
        expect(q.dueForResend(1000).map((d) => d.packetId)).toEqual([1]);
    });

    it('returns due packets ordered by packet id', () => {
        const q: AckQueue = new AckQueue(100);
        q.track(3, wire(3), 0);
        q.track(1, wire(1), 0);
        q.track(2, wire(2), 0);
        expect(q.dueForResend(100).map((d) => d.packetId)).toEqual([1, 2, 3]);
    });

    it('reports packets that exceed the give-up window', () => {
        const q: AckQueue = new AckQueue(500, 30_000);
        q.track(7, wire(7), 1_000);
        expect(q.timedOut(30_000)).toEqual([]);
        expect(q.timedOut(31_000)).toEqual([7]);
    });

    it('stops resending / timing out once acked', () => {
        const q: AckQueue = new AckQueue(100, 1_000);
        q.track(5, wire(5), 0);
        q.ack(5);
        expect(q.dueForResend(1_000)).toEqual([]);
        expect(q.timedOut(5_000)).toEqual([]);
        expect(q.pendingCount).toBe(0);
    });
});
