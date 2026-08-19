import { ConfigStore } from '../Store/ConfigStore.js';
import type { IAIProvider } from './IAIProvider.js';

/**
 * OpenAI-backed {@link IAIProvider}. The key is read from the backend-only
 * `ConfigStore` — it is never accepted from or returned to the frontend. The
 * streaming STT/LLM/TTS wiring (official `openai` SDK, Realtime API) lands in
 * Phase 3; for now this provides the config seam and a presence-based test so the
 * Settings UI is wired end-to-end.
 */
export class OpenAIProvider implements IAIProvider {

    public readonly name: string = 'openai';

    public isConfigured(): boolean {
        return ConfigStore.getInstance().getOpenAiKey().length > 0;
    }

    public async testConnection(): Promise<{ ok: boolean; message: string }> {
        if (!this.isConfigured()) {
            return { ok: false, message: 'no API key configured' };
        }
        // Phase 3 replaces this with a real lightweight call (e.g. GET /models).
        return { ok: true, message: 'API key present (live check added in Phase 3)' };
    }

    public async complete(_systemPrompt: string, _userText: string): Promise<string> {
        throw new Error('OpenAIProvider.complete: not implemented until Phase 3');
    }

}
