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
        // Lightweight live probe: list models. Cheap, no side effects, and proves
        // the key is valid and the API reachable.
        try {
            const response: Response = await fetch('https://api.openai.com/v1/models', {
                headers: { Authorization: `Bearer ${ConfigStore.getInstance().getOpenAiKey()}` },
            });
            if (response.ok) {
                return { ok: true, message: 'connection ok' };
            }
            return { ok: false, message: `OpenAI returned ${response.status}` };
        } catch (error: unknown) {
            return { ok: false, message: (error as Error).message };
        }
    }

    public async complete(_systemPrompt: string, _userText: string): Promise<string> {
        throw new Error('OpenAIProvider.complete: not implemented until Phase 3');
    }
}
