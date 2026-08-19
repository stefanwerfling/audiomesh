import { EventEmitter } from 'node:events';
import { Logger } from 'figtree';
import type { AudioMeshEventName, AudioMeshEventPayloads } from './Events.js';

export type EventHandler<E extends AudioMeshEventName> = (
    payload: AudioMeshEventPayloads[E],
) => void;

/**
 * Process-wide typed event bus. Every domain event flows through here; the WS
 * bridge, metrics collector, transcription pipeline etc. subscribe to it. Thin
 * wrapper over Node's `EventEmitter` that pins the event name → payload mapping
 * from {@link AudioMeshEventPayloads} so `emit`/`on` are type-checked.
 *
 * Singleton (`getInstance`) — house style. Handlers are isolated: a throwing
 * subscriber is caught and logged, never propagated to the emitter, so one bad
 * listener cannot take down an unrelated subsystem (fault-isolation rule).
 */
export class EventBus {

    private static _instance: EventBus | null = null;

    public static getInstance(): EventBus {
        if (EventBus._instance === null) {
            EventBus._instance = new EventBus();
        }
        return EventBus._instance;
    }

    private readonly _emitter: EventEmitter;

    public constructor() {
        this._emitter = new EventEmitter();
        // Domain fan-out can legitimately exceed the default 10 listeners.
        this._emitter.setMaxListeners(100);
    }

    public on<E extends AudioMeshEventName>(event: E, handler: EventHandler<E>): void {
        this._emitter.on(event, handler as (...args: unknown[]) => void);
    }

    public off<E extends AudioMeshEventName>(event: E, handler: EventHandler<E>): void {
        this._emitter.off(event, handler as (...args: unknown[]) => void);
    }

    public emit<E extends AudioMeshEventName>(event: E, payload: AudioMeshEventPayloads[E]): void {
        const handlers: ((...args: unknown[]) => void)[] = this._emitter.listeners(event) as ((
            ...args: unknown[]
        ) => void)[];
        for (const handler of handlers) {
            try {
                handler(payload);
            } catch (error: unknown) {
                Logger.getLogger().error(
                    `EventBus: handler for '${event}' threw: ${(error as Error).message}`,
                );
            }
        }
    }

}
