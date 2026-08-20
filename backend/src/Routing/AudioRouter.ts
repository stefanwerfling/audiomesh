import type { AudioRoute, RouteNode, RouteState } from '@audiomesh/schemas';
import { Logger } from 'figtree';
import { AudioPipeline } from '../Audio/AudioPipeline.js';
import type { IAudioProcessor, IAudioSink, IAudioSource } from '../Audio/IAudio.js';
import { EventBus } from '../Core/EventBus.js';
import { AudioMeshEvent } from '../Core/Events.js';
import type { IRouteNodeResolver } from './IRouteNodeResolver.js';
import { SessionRouteResolver } from './SessionRouteResolver.js';

/** A running route: its live pipeline plus the fan-in source to release on stop. */
interface RunningRoute {
    pipeline: AudioPipeline;
    source: IAudioSource;
}

/**
 * Runtime owner of audio routes. On {@link start} it resolves a route's nodes
 * (source → processors → sink) into concrete audio objects via an
 * {@link IRouteNodeResolver} and wires them through an {@link AudioPipeline} — the
 * same streaming primitive sessions use. Many routes run in parallel, each its own
 * pipeline (e.g. Jitsi → AudioMesh → TeamSpeak). Route *definitions* are persisted
 * in the `ConfigStore`; this holds only the live run-state.
 *
 * Fault isolation: a route that fails to resolve/start is marked `failed` and
 * emits `ErrorOccurred` — it never throws out to the caller or affects other
 * routes.
 */
export class AudioRouter {
    private static _instance: AudioRouter | null = null;

    public static getInstance(): AudioRouter {
        if (AudioRouter._instance === null) {
            AudioRouter._instance = new AudioRouter();
        }
        return AudioRouter._instance;
    }

    private _resolver: IRouteNodeResolver = new SessionRouteResolver();
    private readonly _running: Map<string, RunningRoute> = new Map();
    private readonly _failed: Set<string> = new Set();

    /** Swap the node resolver (tests / alternative routing backends). */
    public setResolver(resolver: IRouteNodeResolver): void {
        this._resolver = resolver;
    }

    public isRunning(routeId: string): boolean {
        return this._running.has(routeId);
    }

    public runningCount(): number {
        return this._running.size;
    }

    /** Live run-state of a route for the API/UI. */
    public getState(routeId: string): RouteState {
        if (this._running.has(routeId)) {
            return 'running';
        }
        if (this._failed.has(routeId)) {
            return 'failed';
        }
        return 'stopped';
    }

    /** Resolve + wire + start a route. Returns whether it is now running. */
    public start(route: AudioRoute): boolean {
        if (this._running.has(route.id)) {
            return true;
        }
        try {
            const sourceNode: RouteNode | undefined = route.nodes.find(
                (n: RouteNode): boolean => n.kind === 'source',
            );
            const sinkNode: RouteNode | undefined = route.nodes.find(
                (n: RouteNode): boolean => n.kind === 'sink',
            );
            if (sourceNode === undefined || sinkNode === undefined) {
                throw new Error('a route needs one source node and one sink node');
            }
            const source: IAudioSource = this._resolver.resolveSource(sourceNode);
            const processors: IAudioProcessor[] = route.nodes
                .filter((n: RouteNode): boolean => n.kind === 'processor')
                .map((n: RouteNode): IAudioProcessor | null => this._resolver.resolveProcessor(n))
                .filter((p: IAudioProcessor | null): p is IAudioProcessor => p !== null);
            const sink: IAudioSink = this._resolver.resolveSink(sinkNode);

            const pipeline: AudioPipeline = new AudioPipeline(source, processors, sink);
            pipeline.start();
            this._running.set(route.id, { pipeline: pipeline, source: source });
            this._failed.delete(route.id);
            EventBus.getInstance().emit(AudioMeshEvent.AudioRouteStarted, { routeId: route.id });
            return true;
        } catch (error: unknown) {
            this._failed.add(route.id);
            const message: string = `route '${route.id}' start failed: ${(error as Error).message}`;
            Logger.getLogger().error(`AudioRouter: ${message}`);
            EventBus.getInstance().emit(AudioMeshEvent.ErrorOccurred, {
                component: 'AudioRouter',
                message: message,
            });
            return false;
        }
    }

    public stop(routeId: string): void {
        this._failed.delete(routeId);
        const entry: RunningRoute | undefined = this._running.get(routeId);
        if (entry === undefined) {
            return;
        }
        this._running.delete(routeId);
        entry.pipeline.stop();
        // Release the fan-in tap; the sink (a session's send path) is owned by that
        // session's adapter, so it is never closed here.
        entry.source.close();
        EventBus.getInstance().emit(AudioMeshEvent.AudioRouteStopped, { routeId: routeId });
    }
}
