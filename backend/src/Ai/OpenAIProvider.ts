import { ConfigStore } from '../Store/ConfigStore.js';
import type { IAIProvider } from './IAIProvider.js';

/**
 * OpenAI-backed {@link IAIProvider}. The key is read from the backend-only
 * `ConfigStore` — it is never accepted from or returned to the frontend. Streaming
 * STT lives in {@link ../Transcription/OpenAITranscriptionProvider} and TTS in
 * {@link OpenAISpeechSynthesisProvider}; this class provides the config seam, a
 * live connectivity test, and the single-turn `complete()` the agent (Phase 7)
 * builds on. `fetch` is Node's global — no SDK dependency.
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
            const store: ConfigStore = ConfigStore.getInstance();
            const response: Response = await fetch(`${store.getOpenAiBaseUrl()}/v1/models`, {
                headers: { Authorization: `Bearer ${store.getOpenAiKey()}` },
            });
            if (response.ok) {
                return { ok: true, message: 'connection ok' };
            }
            return { ok: false, message: `OpenAI returned ${response.status}` };
        } catch (error: unknown) {
            return { ok: false, message: (error as Error).message };
        }
    }

    /**
     * List the model ids a gateway advertises via `/v1/models`. Static because
     * the Settings "Load models" flow probes an explicit base URL + key (which may
     * not be saved yet) rather than the stored config. Never throws — failures
     * come back as `{ ok: false, message }` for the UI.
     */
    public static async listModels(
        baseUrl: string,
        apiKey: string,
    ): Promise<{ ok: boolean; models: string[]; message: string }> {
        if (apiKey.length === 0) {
            return { ok: false, models: [], message: 'no API key configured' };
        }
        try {
            const base: string = baseUrl.replace(/\/+$/, '');
            const response: Response = await fetch(`${base}/v1/models`, {
                headers: { Authorization: `Bearer ${apiKey}` },
            });
            if (!response.ok) {
                return { ok: false, models: [], message: `gateway returned ${response.status}` };
            }
            const models: string[] = OpenAIProvider._modelIds(await response.json());
            return { ok: true, models: models, message: `${models.length} models` };
        } catch (error: unknown) {
            return { ok: false, models: [], message: (error as Error).message };
        }
    }

    /** Extract sorted model ids from an OpenAI `/v1/models` list body. */
    private static _modelIds(payload: unknown): string[] {
        if (payload === null || typeof payload !== 'object') {
            return [];
        }
        const data: unknown = (payload as Record<string, unknown>)['data'];
        if (!Array.isArray(data)) {
            return [];
        }
        const ids: string[] = [];
        for (const entry of data) {
            if (entry !== null && typeof entry === 'object') {
                const id: unknown = (entry as Record<string, unknown>)['id'];
                if (typeof id === 'string' && id.length > 0) {
                    ids.push(id);
                }
            }
        }
        return ids.sort((a: string, b: string): number => a.localeCompare(b));
    }

    public async complete(systemPrompt: string, userText: string): Promise<string> {
        const store: ConfigStore = ConfigStore.getInstance();
        const apiKey: string = store.getOpenAiKey();
        if (apiKey.length === 0) {
            throw new Error('OpenAI API key not configured');
        }
        const model: string = store.getSettings().openai.model || 'gpt-4o';

        const response: Response = await fetch(`${store.getOpenAiBaseUrl()}/v1/chat/completions`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model: model,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userText },
                ],
            }),
        });
        if (!response.ok) {
            throw new Error(`OpenAI chat completion failed: ${response.status}`);
        }

        const payload: unknown = await response.json();
        const content: string | null = OpenAIProvider._firstChoiceContent(payload);
        if (content === null) {
            throw new Error('OpenAI chat completion returned no message content');
        }
        return content;
    }

    /** Tolerant extraction of `choices[0].message.content` from an unknown body. */
    private static _firstChoiceContent(payload: unknown): string | null {
        if (payload === null || typeof payload !== 'object') {
            return null;
        }
        const choices: unknown = (payload as Record<string, unknown>)['choices'];
        if (!Array.isArray(choices) || choices.length === 0) {
            return null;
        }
        const first: unknown = choices[0];
        if (first === null || typeof first !== 'object') {
            return null;
        }
        const message: unknown = (first as Record<string, unknown>)['message'];
        if (message === null || typeof message !== 'object') {
            return null;
        }
        const content: unknown = (message as Record<string, unknown>)['content'];
        return typeof content === 'string' ? content : null;
    }
}
