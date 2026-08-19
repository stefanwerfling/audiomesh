/**
 * Abstraction over the AI backend. OpenAI is the only implementation for now,
 * but the Core depends only on this interface so a different provider (or a local
 * model, later) can drop in without touching sessions/agents. The API key lives
 * exclusively behind the implementation — callers never see it.
 */
export interface IAIProvider {
    readonly name: string;

    /** Whether the provider is configured (key present) and reachable. */
    isConfigured(): boolean;

    /** One-shot connectivity probe used by the Settings "Test connection" button. */
    testConnection(): Promise<{ ok: boolean; message: string }>;

    /**
     * Single-turn completion. The full streaming agent surface (tool calling,
     * context, TTS) is layered on in Phase 7 — this is the minimal seam the rest
     * of the system can already depend on.
     */
    complete(systemPrompt: string, userText: string): Promise<string>;
}
