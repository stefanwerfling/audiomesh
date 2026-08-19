import { Vts, type ExtractSchemaResultType } from 'vts';
import { ConnectionStateSchema, PlatformKindSchema } from './Common.js';
import { ParticipantSchema } from './Participant.js';

/** Live audio state of a session — whether frames are currently flowing. */
export const AudioStateSchema = Vts.or([
    Vts.equal('idle' as const),
    Vts.equal('active' as const),
]);
export type AudioState = ExtractSchemaResultType<typeof AudioStateSchema>;

/**
 * A voice session as exposed to the frontend. Mirrors the backend `VoiceSession`
 * minus the runtime audio handles. Times are Unix epoch ms; `connectedAt` is
 * absent until the connection actually establishes.
 */
export const SessionSchema = Vts.object({
    sessionId: Vts.string(),
    platform: PlatformKindSchema,
    platformId: Vts.string(),
    channelId: Vts.string(),
    channelName: Vts.string(),
    connectionState: ConnectionStateSchema,
    audioState: AudioStateSchema,
    transcriptionEnabled: Vts.boolean(),
    participants: Vts.array(ParticipantSchema),
    createdAt: Vts.number(),
    connectedAt: Vts.optional(Vts.number()),
});
export type Session = ExtractSchemaResultType<typeof SessionSchema>;

/** Body for starting a new session on a configured platform. */
export const SessionStartBodySchema = Vts.object({
    platformId: Vts.string(),
    channelId: Vts.string(),
    transcriptionEnabled: Vts.optional(Vts.boolean()),
});
export type SessionStartBody = ExtractSchemaResultType<typeof SessionStartBodySchema>;

/** List + nullable response schemas (figtree requires a response schema to emit a body). */
export const SessionListSchema = Vts.array(SessionSchema);
export const SessionNullableSchema = Vts.or([SessionSchema, Vts.null()]);

/** A single transcript line kept for a session (when transcript storage is on). */
export const TranscriptLineSchema = Vts.object({
    speakerId: Vts.string(),
    speakerName: Vts.optional(Vts.string()),
    text: Vts.string(),
    language: Vts.optional(Vts.string()),
    confidence: Vts.optional(Vts.number()),
    final: Vts.boolean(),
    timestamp: Vts.number(),
});
export type TranscriptLine = ExtractSchemaResultType<typeof TranscriptLineSchema>;
