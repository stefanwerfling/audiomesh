import { Vts, type ExtractSchemaResultType } from 'vts';
import { PlatformKindSchema } from './Common.js';

/**
 * A configured voice platform. `config` is an opaque key/value bag whose shape
 * depends on `kind` (e.g. Discord needs a bot token, TeamSpeak a host/port).
 * Secrets are never returned to the frontend — the backend redacts them and the
 * UI only sees `configured: true|false` per secret field.
 */
export const PlatformSchema = Vts.object({
    id: Vts.string(),
    kind: PlatformKindSchema,
    name: Vts.string(),
    enabled: Vts.boolean(),
    connected: Vts.boolean(),
    config: Vts.optional(Vts.object2(Vts.string(), Vts.unknown())),
});
export type Platform = ExtractSchemaResultType<typeof PlatformSchema>;

/** Body for creating/updating a platform. `config` may carry secrets inbound. */
export const PlatformBodySchema = Vts.object({
    kind: PlatformKindSchema,
    name: Vts.string(),
    enabled: Vts.boolean(),
    config: Vts.optional(Vts.object2(Vts.string(), Vts.unknown())),
});
export type PlatformBody = ExtractSchemaResultType<typeof PlatformBodySchema>;

export const PlatformListSchema = Vts.array(PlatformSchema);
export const PlatformNullableSchema = Vts.or([PlatformSchema, Vts.null()]);

/** Result of a platform connection test. */
export const PlatformTestResultSchema = Vts.object({
    ok: Vts.boolean(),
    message: Vts.string(),
});
export type PlatformTestResult = ExtractSchemaResultType<typeof PlatformTestResultSchema>;
