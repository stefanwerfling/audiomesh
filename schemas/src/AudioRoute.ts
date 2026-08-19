import { Vts, type ExtractSchemaResultType } from 'vts';

/**
 * Kind of a routing node. The routing model is a graph from the start so the
 * later visual editor is additive:
 *  - `source` — produces audio (a session's participant/mix).
 *  - `processor` — transforms audio in place (vad, resample, normalize, ...).
 *  - `sink` — consumes audio (another platform, transcription, recorder).
 */
export const RouteNodeKindSchema = Vts.or([
    Vts.equal('source' as const),
    Vts.equal('processor' as const),
    Vts.equal('sink' as const),
]);
export type RouteNodeKind = ExtractSchemaResultType<typeof RouteNodeKindSchema>;

/** A single node in an audio route. `ref` points at the concrete backing object
 *  (session id, processor type, sink target) resolved by the router. */
export const RouteNodeSchema = Vts.object({
    id: Vts.string(),
    kind: RouteNodeKindSchema,
    type: Vts.string(),
    ref: Vts.optional(Vts.string()),
});
export type RouteNode = ExtractSchemaResultType<typeof RouteNodeSchema>;

/** Run state of a route. */
export const RouteStateSchema = Vts.or([
    Vts.equal('stopped' as const),
    Vts.equal('running' as const),
    Vts.equal('failed' as const),
]);
export type RouteState = ExtractSchemaResultType<typeof RouteStateSchema>;

/**
 * An audio route: an ordered chain of nodes (source → processors → sink).
 * Multiple routes run in parallel. Stored as a linear chain for the MVP but the
 * node array already models a DAG edge list for the future graph UI.
 */
export const AudioRouteSchema = Vts.object({
    id: Vts.string(),
    name: Vts.string(),
    enabled: Vts.boolean(),
    state: RouteStateSchema,
    nodes: Vts.array(RouteNodeSchema),
});
export type AudioRoute = ExtractSchemaResultType<typeof AudioRouteSchema>;

export const AudioRouteListSchema = Vts.array(AudioRouteSchema);
export const AudioRouteNullableSchema = Vts.or([AudioRouteSchema, Vts.null()]);

/** Body for creating/updating a route. */
export const AudioRouteBodySchema = Vts.object({
    name: Vts.string(),
    enabled: Vts.boolean(),
    nodes: Vts.array(RouteNodeSchema),
});
export type AudioRouteBody = ExtractSchemaResultType<typeof AudioRouteBodySchema>;
