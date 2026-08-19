import type { AudioRoute } from '@audiomesh/schemas';
import { EventBus } from '../Core/EventBus.js';
import { AudioMeshEvent } from '../Core/Events.js';

/**
 * Runtime owner of audio routes. For the MVP it tracks route run-state and emits
 * start/stop events; the actual frame-moving (source → processors → sink across
 * platforms, multiple in parallel) is built out in Phase 5 on top of the same
 * {@link AudioPipeline} the sessions already use. Route *definitions* are
 * persisted in the `ConfigStore`; this holds only the live run-state.
 */
export class AudioRouter {

    private static _instance: AudioRouter | null = null;

    public static getInstance(): AudioRouter {
        if (AudioRouter._instance === null) {
            AudioRouter._instance = new AudioRouter();
        }
        return AudioRouter._instance;
    }

    private readonly _running: Set<string> = new Set();

    public isRunning(routeId: string): boolean {
        return this._running.has(routeId);
    }

    public runningCount(): number {
        return this._running.size;
    }

    public start(route: AudioRoute): void {
        if (this._running.has(route.id)) {
            return;
        }
        this._running.add(route.id);
        EventBus.getInstance().emit(AudioMeshEvent.AudioRouteStarted, { routeId: route.id });
    }

    public stop(routeId: string): void {
        if (!this._running.has(routeId)) {
            return;
        }
        this._running.delete(routeId);
        EventBus.getInstance().emit(AudioMeshEvent.AudioRouteStopped, { routeId: routeId });
    }

}
