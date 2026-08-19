import { Vts, type ExtractSchemaResultType } from 'vts';

/**
 * OpenAI configuration as exposed to the frontend. The API key is NEVER sent
 * back — the UI only learns whether one is configured via `apiKeyConfigured`
 * and whether the last connection check passed via `connected`.
 */
export const OpenAiSettingsSchema = Vts.object({
    apiKeyConfigured: Vts.boolean(),
    connected: Vts.boolean(),
    model: Vts.string(),
    transcriptionModel: Vts.string(),
    ttsModel: Vts.string(),
    voice: Vts.string(),
});
export type OpenAiSettings = ExtractSchemaResultType<typeof OpenAiSettingsSchema>;

/**
 * Privacy defaults. All storage-related switches default to OFF — audio and
 * transcripts can be sensitive, so nothing is persisted unless the operator
 * opts in. `retentionDays` bounds transcript storage when it is enabled.
 */
export const PrivacySettingsSchema = Vts.object({
    recordingEnabled: Vts.boolean(),
    transcriptStorageEnabled: Vts.boolean(),
    retentionDays: Vts.number(),
});
export type PrivacySettings = ExtractSchemaResultType<typeof PrivacySettingsSchema>;

/** Full settings resource returned by `GET /api/v1/settings`. */
export const SettingsSchema = Vts.object({
    openai: OpenAiSettingsSchema,
    privacy: PrivacySettingsSchema,
});
export type Settings = ExtractSchemaResultType<typeof SettingsSchema>;

/**
 * Settings write body. `openai.apiKey` is write-only and optional — omitting it
 * (or sending an empty string) leaves the stored key untouched, so the UI can
 * save other fields without re-entering the secret.
 */
export const OpenAiSettingsBodySchema = Vts.object({
    apiKey: Vts.optional(Vts.string()),
    model: Vts.string(),
    transcriptionModel: Vts.string(),
    ttsModel: Vts.string(),
    voice: Vts.string(),
});
export type OpenAiSettingsBody = ExtractSchemaResultType<typeof OpenAiSettingsBodySchema>;

export const SettingsBodySchema = Vts.object({
    openai: OpenAiSettingsBodySchema,
    privacy: PrivacySettingsSchema,
});
export type SettingsBody = ExtractSchemaResultType<typeof SettingsBodySchema>;

/** Result of an OpenAI connection probe (Settings → "Test connection"). */
export const OpenAiTestResultSchema = Vts.object({
    ok: Vts.boolean(),
    message: Vts.string(),
});
export type OpenAiTestResult = ExtractSchemaResultType<typeof OpenAiTestResultSchema>;
