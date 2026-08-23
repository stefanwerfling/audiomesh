import { describe, expect, it } from 'vitest';
import { VoiceCounter } from '../../../../src/Platform/Adapters/TeamSpeak/protocol/voice/VoiceCounter.js';

describe('VoiceCounter', () => {
    it('post-increments from 0', () => {
        const counter: VoiceCounter = new VoiceCounter();
        expect(counter.peek()).toBe(0);
        expect(counter.next()).toBe(0);
        expect(counter.next()).toBe(1);
        expect(counter.next()).toBe(2);
        expect(counter.peek()).toBe(3);
    });

    it('wraps 0xffff → 0', () => {
        const counter: VoiceCounter = new VoiceCounter(0xffff);
        expect(counter.next()).toBe(0xffff);
        expect(counter.next()).toBe(0);
        expect(counter.next()).toBe(1);
    });

    it('resets', () => {
        const counter: VoiceCounter = new VoiceCounter();
        counter.next();
        counter.next();
        counter.reset();
        expect(counter.next()).toBe(0);
        counter.reset(100);
        expect(counter.next()).toBe(100);
    });
});
