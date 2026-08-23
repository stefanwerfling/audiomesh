import { describe, expect, it } from 'vitest';
import { KeepAlive } from '../../../../src/Platform/Adapters/TeamSpeak/protocol/reliability/KeepAlive.js';

describe('KeepAlive', () => {
    it('does nothing before start', () => {
        const k: KeepAlive = new KeepAlive();
        expect(k.shouldPing(10_000)).toBe(false);
        expect(k.isTimedOut(10_000)).toBe(false);
    });

    it('signals a ping once per interval', () => {
        const k: KeepAlive = new KeepAlive(1_000, 30_000);
        k.start(0);
        expect(k.shouldPing(999)).toBe(false);
        expect(k.shouldPing(1_000)).toBe(true);
        k.markPinged(1_000);
        expect(k.shouldPing(1_500)).toBe(false);
        expect(k.shouldPing(2_000)).toBe(true);
    });

    it('times out after the window with no received packet', () => {
        const k: KeepAlive = new KeepAlive(1_000, 30_000);
        k.start(0);
        expect(k.isTimedOut(29_999)).toBe(false);
        expect(k.isTimedOut(30_000)).toBe(true);
    });

    it('a received packet resets the timeout window', () => {
        const k: KeepAlive = new KeepAlive(1_000, 30_000);
        k.start(0);
        k.onPacketReceived(20_000);
        expect(k.isTimedOut(30_000)).toBe(false);
        expect(k.isTimedOut(50_000)).toBe(true);
    });
});
