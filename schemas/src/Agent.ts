import { Vts, type ExtractSchemaResultType } from 'vts';

/** How an agent decides when to respond in a voice session. */
export const AgentResponseModeSchema = Vts.or([
    Vts.equal('manual' as const),
    Vts.equal('wake-word' as const),
    Vts.equal('always' as const),
]);
export type AgentResponseMode = ExtractSchemaResultType<typeof AgentResponseModeSchema>;

/**
 * An agent profile. Only the architecture/shape is needed for the MVP — the
 * runtime agent lands in Phase 7. `enabledTools` is a free list of tool ids the
 * agent may call once tool-calling is implemented.
 */
export const AgentProfileSchema = Vts.object({
    id: Vts.string(),
    name: Vts.string(),
    systemPrompt: Vts.string(),
    model: Vts.string(),
    voice: Vts.optional(Vts.string()),
    language: Vts.optional(Vts.string()),
    personality: Vts.optional(Vts.string()),
    responseMode: AgentResponseModeSchema,
    enabledTools: Vts.array(Vts.string()),
});
export type AgentProfile = ExtractSchemaResultType<typeof AgentProfileSchema>;

export const AgentProfileListSchema = Vts.array(AgentProfileSchema);
export const AgentProfileNullableSchema = Vts.or([AgentProfileSchema, Vts.null()]);

/** Body for creating/updating an agent profile. */
export const AgentProfileBodySchema = Vts.object({
    name: Vts.string(),
    systemPrompt: Vts.string(),
    model: Vts.string(),
    voice: Vts.optional(Vts.string()),
    language: Vts.optional(Vts.string()),
    personality: Vts.optional(Vts.string()),
    responseMode: AgentResponseModeSchema,
    enabledTools: Vts.array(Vts.string()),
});
export type AgentProfileBody = ExtractSchemaResultType<typeof AgentProfileBodySchema>;
