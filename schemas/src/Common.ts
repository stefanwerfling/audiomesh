import { Vts, type ExtractSchemaResultType } from 'vts';

/**
 * Voice platform kind. The wire value that identifies which adapter backs a
 * platform / session. New platforms extend this union — the Core never switches
 * on it, only the adapter registry does.
 */
export const PlatformKindSchema = Vts.or([
    Vts.equal('mock' as const),
    Vts.equal('discord' as const),
    Vts.equal('teamspeak' as const),
    Vts.equal('jitsi' as const),
]);
export type PlatformKind = ExtractSchemaResultType<typeof PlatformKindSchema>;

/**
 * Lifecycle state of a voice connection. Matches `VoiceSession.connectionState`
 * on the backend one-to-one.
 */
export const ConnectionStateSchema = Vts.or([
    Vts.equal('connecting' as const),
    Vts.equal('connected' as const),
    Vts.equal('reconnecting' as const),
    Vts.equal('disconnecting' as const),
    Vts.equal('disconnected' as const),
    Vts.equal('failed' as const),
]);
export type ConnectionState = ExtractSchemaResultType<typeof ConnectionStateSchema>;

/** Whether a participant is currently producing speech audio. */
export const SpeakingStateSchema = Vts.or([
    Vts.equal('speaking' as const),
    Vts.equal('silent' as const),
]);
export type SpeakingState = ExtractSchemaResultType<typeof SpeakingStateSchema>;

/**
 * Generic API envelope for mutating/among simple endpoints that only need to
 * report success plus an optional human-readable message. Reads that return a
 * resource return the resource directly (finedge convention).
 */
export const ApiResultSchema = Vts.object({
    ok: Vts.boolean(),
    message: Vts.optional(Vts.string()),
});
export type ApiResult = ExtractSchemaResultType<typeof ApiResultSchema>;
