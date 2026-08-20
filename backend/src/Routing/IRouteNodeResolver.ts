import type { RouteNode } from '@audiomesh/schemas';
import type { IAudioProcessor, IAudioSink, IAudioSource } from '../Audio/IAudio.js';

/**
 * Turns a route's abstract {@link RouteNode}s into concrete audio objects. The
 * {@link AudioRouter} depends only on this, so what a node *means* (a session's
 * mixed audio, another platform's send path, a gain stage) lives in one place and
 * the router stays pure wiring — and testable with a fake resolver.
 *
 * A node that cannot be resolved throws; the router turns that into a failed route
 * plus an `ErrorOccurred` event rather than crashing.
 */
export interface IRouteNodeResolver {
    resolveSource(node: RouteNode): IAudioSource;
    /** Returns null for a no-op node (e.g. `passthrough`), which is skipped. */
    resolveProcessor(node: RouteNode): IAudioProcessor | null;
    resolveSink(node: RouteNode): IAudioSink;
}
