import { afterEach, describe, expect, it, vi } from 'vitest';
import { OpenAISpeechSynthesisProvider } from '../../src/Ai/OpenAISpeechSynthesisProvider.js';
import type { SynthesizedSpeech } from '../../src/Ai/ISpeechSynthesisProvider.js';
import { ConfigStore } from '../../src/Store/ConfigStore.js';

/** Install a ConfigStore stub with the given key, TTS model and voice. */
function stubConfig(
    apiKey: string,
    ttsModel: string = 'gpt-4o-mini-tts',
    voice: string = 'alloy',
): void {
    vi.spyOn(ConfigStore, 'getInstance').mockReturnValue({
        getOpenAiKey: (): string => apiKey,
        getOpenAiBaseUrl: (): string => 'https://api.openai.com',
        getSettings: () => ({
            openai: {
                apiKeyConfigured: apiKey.length > 0,
                connected: false,
                baseUrl: 'https://api.openai.com',
                model: 'gpt-4o',
                transcriptionModel: 'gpt-4o-transcribe',
                transcriptionMode: 'realtime',
                ttsModel: ttsModel,
                voice: voice,
            },
            privacy: {
                recordingEnabled: false,
                transcriptStorageEnabled: false,
                retentionDays: 30,
            },
        }),
    } as unknown as ConfigStore);
}

describe('OpenAISpeechSynthesisProvider.synthesize', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it('requests pcm speech and returns 24 kHz mono PCM', async () => {
        stubConfig('sk-test', 'gpt-4o-mini-tts', 'verse');
        const audio: Buffer = Buffer.from([1, 2, 3, 4]);
        const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            arrayBuffer: async () =>
                audio.buffer.slice(audio.byteOffset, audio.byteOffset + audio.length),
        });
        vi.stubGlobal('fetch', fetchMock);

        const result: SynthesizedSpeech = await new OpenAISpeechSynthesisProvider().synthesize(
            'hi',
        );

        expect(result.sampleRate).toBe(24000);
        expect(result.channels).toBe(1);
        expect(Buffer.compare(result.pcm, audio)).toBe(0);

        const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
        expect(url).toBe('https://api.openai.com/v1/audio/speech');
        const body = JSON.parse(init.body as string) as Record<string, string>;
        expect(body).toEqual({
            model: 'gpt-4o-mini-tts',
            voice: 'verse',
            input: 'hi',
            response_format: 'pcm',
        });
    });

    it('rejects when no API key is configured', async () => {
        stubConfig('');
        await expect(new OpenAISpeechSynthesisProvider().synthesize('hi')).rejects.toThrow(
            'OpenAI API key not configured',
        );
    });

    it('rejects on a non-ok HTTP response', async () => {
        stubConfig('sk-test');
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));
        await expect(new OpenAISpeechSynthesisProvider().synthesize('hi')).rejects.toThrow('500');
    });
});
