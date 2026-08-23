import { describe, expect, it } from 'vitest';
import {
    IncomingGenerationTracker,
    OutgoingPacketCounter,
} from '../../../../src/Platform/Adapters/TeamSpeak/protocol/reliability/PacketCounter.js';

describe('OutgoingPacketCounter', () => {
    it('starts at 1 and increments', () => {
        const c: OutgoingPacketCounter = new OutgoingPacketCounter();
        expect(c.next()).toEqual({ packetId: 1, generationId: 0 });
        expect(c.next()).toEqual({ packetId: 2, generationId: 0 });
        expect(c.peek()).toEqual({ packetId: 3, generationId: 0 });
    });

    it('wraps 65535→0 and bumps the generation on the wrapping packet', () => {
        const c: OutgoingPacketCounter = new OutgoingPacketCounter(0xffff);
        expect(c.next()).toEqual({ packetId: 0xffff, generationId: 0 });
        // The wrap packet (id 0) already carries the new generation.
        expect(c.next()).toEqual({ packetId: 0, generationId: 1 });
        expect(c.next()).toEqual({ packetId: 1, generationId: 1 });
    });
});

describe('IncomingGenerationTracker', () => {
    it('stays in generation 0 for in-order ids', () => {
        const t: IncomingGenerationTracker = new IncomingGenerationTracker();
        expect(t.generationFor(1)).toBe(0);
        expect(t.generationFor(2)).toBe(0);
        expect(t.generationFor(1000)).toBe(0);
    });

    it('advances the generation across the wrap', () => {
        const t: IncomingGenerationTracker = new IncomingGenerationTracker();
        expect(t.generationFor(0xfffe)).toBe(0);
        expect(t.generationFor(0xffff)).toBe(0);
        expect(t.generationFor(0)).toBe(1);
        expect(t.generationFor(1)).toBe(1);
    });

    it('attributes a straggler from before the wrap to the previous generation', () => {
        const t: IncomingGenerationTracker = new IncomingGenerationTracker();
        t.generationFor(0xfffe);
        t.generationFor(0); // wrap → gen 1
        expect(t.generation).toBe(1);
        // A reordered 0xffff arriving late belongs to generation 0.
        expect(t.generationFor(0xffff)).toBe(0);
    });
});
