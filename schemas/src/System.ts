import { Vts, type ExtractSchemaResultType } from 'vts';

/** Liveness/health snapshot for `GET /api/v1/system/health`. */
export const HealthSchema = Vts.object({
    ok: Vts.boolean(),
    version: Vts.string(),
    uptimeSeconds: Vts.number(),
});
export type Health = ExtractSchemaResultType<typeof HealthSchema>;

/**
 * Runtime metrics for the dashboard. All counters are point-in-time snapshots
 * the frontend polls-via-WS / refreshes. Latencies are milliseconds; absent
 * subsystems report 0 rather than being omitted so the tiles stay stable.
 */
export const MetricsSchema = Vts.object({
    activeSessions: Vts.number(),
    participants: Vts.number(),
    activeRoutes: Vts.number(),
    audioPacketsPerSecond: Vts.number(),
    audioLatencyMs: Vts.number(),
    transcriptionLatencyMs: Vts.number(),
    openaiLatencyMs: Vts.number(),
    droppedFrames: Vts.number(),
    reconnects: Vts.number(),
    queueSize: Vts.number(),
    cpuPercent: Vts.number(),
    memoryMb: Vts.number(),
});
export type Metrics = ExtractSchemaResultType<typeof MetricsSchema>;

/** A single structured log/event entry for the frontend log panel. */
export const LogEntrySchema = Vts.object({
    timestamp: Vts.number(),
    level: Vts.string(),
    component: Vts.string(),
    event: Vts.string(),
    sessionId: Vts.optional(Vts.string()),
    platform: Vts.optional(Vts.string()),
    durationMs: Vts.optional(Vts.number()),
    error: Vts.optional(Vts.string()),
});
export type LogEntry = ExtractSchemaResultType<typeof LogEntrySchema>;

export const LogListSchema = Vts.object({
    entries: Vts.array(LogEntrySchema),
});
export type LogList = ExtractSchemaResultType<typeof LogListSchema>;
