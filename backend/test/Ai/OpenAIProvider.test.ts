import { afterEach, describe, expect, it, vi } from 'vitest';
import { OpenAIProvider } from '../../src/Ai/OpenAIProvider.js';
import { ConfigStore } from '../../src/Store/ConfigStore.js';

/** Install a ConfigStore stub with the given key and LLM model. */
function stubConfig(apiKey: string, model: string = 'gpt-4o'): void {
    vi.spyOn(ConfigStore, 'getInstance').mockReturnValue({
        getOpenAiKey: (): string => apiKey,
        getOpenAiBaseUrl: (): string => 'https://api.openai.com',
        getSettings: () => ({
            openai: {
                apiKeyConfigured: apiKey.length > 0,
                connected: false,
                baseUrl: 'https://api.openai.com',
                model: model,
                transcriptionModel: 'gpt-4o-transcribe',
                transcriptionMode: 'realtime',
                ttsModel: 'gpt-4o-mini-tts',
                voice: 'alloy',
            },
            privacy: {
                recordingEnabled: false,
                transcriptStorageEnabled: false,
                retentionDays: 30,
            },
        }),
    } as unknown as ConfigStore);
}

describe('OpenAIProvider.complete', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it('posts a system+user chat completion and returns the assistant content', async () => {
        stubConfig('sk-test', 'gpt-4o-mini');
        const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({ choices: [{ message: { content: 'hello there' } }] }),
        });
        vi.stubGlobal('fetch', fetchMock);

        const result: string = await new OpenAIProvider().complete('be terse', 'hi');

        expect(result).toBe('hello there');
        expect(fetchMock).toHaveBeenCalledTimes(1);
        const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
        expect(url).toBe('https://api.openai.com/v1/chat/completions');
        expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer sk-test');
        const body = JSON.parse(init.body as string) as {
            model: string;
            messages: Array<{ role: string; content: string }>;
        };
        expect(body.model).toBe('gpt-4o-mini');
        expect(body.messages).toEqual([
            { role: 'system', content: 'be terse' },
            { role: 'user', content: 'hi' },
        ]);
    });

    it('rejects when no API key is configured', async () => {
        stubConfig('');
        await expect(new OpenAIProvider().complete('s', 'u')).rejects.toThrow(
            'OpenAI API key not configured',
        );
    });

    it('rejects on a non-ok HTTP response', async () => {
        stubConfig('sk-test');
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 429 }));
        await expect(new OpenAIProvider().complete('s', 'u')).rejects.toThrow('429');
    });

    it('rejects when the response carries no message content', async () => {
        stubConfig('sk-test');
        vi.stubGlobal(
            'fetch',
            vi.fn().mockResolvedValue({ ok: true, json: async () => ({ choices: [] }) }),
        );
        await expect(new OpenAIProvider().complete('s', 'u')).rejects.toThrow('no message content');
    });
});

describe('OpenAIProvider.listModels', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it('returns the gateway model ids, sorted, from /v1/models', async () => {
        const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({
                object: 'list',
                data: [{ id: 'whisper' }, { id: 'primary' }, { id: 'tts' }],
            }),
        });
        vi.stubGlobal('fetch', fetchMock);

        const result = await OpenAIProvider.listModels('https://gw.example.com/', 'pgn_key');

        expect(result.ok).toBe(true);
        expect(result.models).toEqual(['primary', 'tts', 'whisper']);
        const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
        expect(url).toBe('https://gw.example.com/v1/models'); // trailing slash trimmed
        expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer pgn_key');
    });

    it('reports not-ok without a key and never throws', async () => {
        const result = await OpenAIProvider.listModels('https://gw.example.com', '');
        expect(result).toEqual({ ok: false, models: [], message: 'no API key configured' });
    });

    it('reports the HTTP status on a non-ok response', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401 }));
        const result = await OpenAIProvider.listModels('https://gw.example.com', 'k');
        expect(result.ok).toBe(false);
        expect(result.message).toContain('401');
    });
});
