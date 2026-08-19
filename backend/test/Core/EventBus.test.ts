import { describe, expect, it, vi } from 'vitest';
import { EventBus } from '../../src/Core/EventBus.js';
import { AudioMeshEvent } from '../../src/Core/Events.js';

describe('EventBus', () => {

    it('delivers a typed payload to a subscriber', () => {
        const bus: EventBus = new EventBus();
        const seen: string[] = [];
        bus.on(AudioMeshEvent.VoiceSessionStarted, (p): void => {
            seen.push(p.sessionId);
        });
        bus.emit(AudioMeshEvent.VoiceSessionStarted, { sessionId: 's-1' });
        expect(seen).toEqual(['s-1']);
    });

    it('isolates a throwing handler from the others (fault isolation)', () => {
        const bus: EventBus = new EventBus();
        const good = vi.fn();
        bus.on(AudioMeshEvent.ErrorOccurred, (): void => {
            throw new Error('boom');
        });
        bus.on(AudioMeshEvent.ErrorOccurred, good);
        expect((): void =>
            bus.emit(AudioMeshEvent.ErrorOccurred, { component: 'x', message: 'y' }),
        ).not.toThrow();
        expect(good).toHaveBeenCalledOnce();
    });

    it('stops delivering after off()', () => {
        const bus: EventBus = new EventBus();
        const fn = vi.fn();
        bus.on(AudioMeshEvent.AudioStarted, fn);
        bus.off(AudioMeshEvent.AudioStarted, fn);
        bus.emit(AudioMeshEvent.AudioStarted, { sessionId: 's-2' });
        expect(fn).not.toHaveBeenCalled();
    });

});
