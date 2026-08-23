import { ConfigStore } from '../Store/ConfigStore.js';
import type { ISpeechSynthesisProvider, SynthesizedSpeech } from './ISpeechSynthesisProvider.js';

/** OpenAI's `pcm` speech output is 24 kHz mono s16le. */
const OPENAI_OUTPUT_SAMPLE_RATE: number = 24000;

/**
 * OpenAI-backed {@link ISpeechSynthesisProvider}. Calls the speech endpoint with
 * `response_format: pcm`, so the body is raw 24 kHz mono s16le PCM — no container
 * to demux — which the talkback path resamples down to the mesh's 16 kHz. Model and
 * voice come from the backend-only `ConfigStore` settings; the key never leaves the
 * backend. `fetch` is Node's global, so there is no SDK dependency (symmetric with
 * {@link OpenAIProvider} and {@link ../Transcription/OpenAIRealtimeTranscriptionSession}).
 */
export class OpenAISpeechSynthesisProvider implements ISpeechSynthesisProvider {
    public readonly name: string = 'openai';

    public isConfigured(): boolean {
        return ConfigStore.getInstance().getOpenAiKey().length > 0;
    }

    public async synthesize(text: string): Promise<SynthesizedSpeech> {
        const store: ConfigStore = ConfigStore.getInstance();
        const apiKey: string = store.getOpenAiKey();
        if (apiKey.length === 0) {
            throw new Error('OpenAI API key not configured');
        }
        const settings: ReturnType<ConfigStore['getSettings']> = store.getSettings();
        const model: string = settings.openai.ttsModel || 'gpt-4o-mini-tts';
        const voice: string = settings.openai.voice || 'alloy';

        const response: Response = await fetch(`${store.getOpenAiBaseUrl()}/v1/audio/speech`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model: model,
                voice: voice,
                input: text,
                response_format: 'pcm',
            }),
        });
        if (!response.ok) {
            throw new Error(`OpenAI speech synthesis failed: ${response.status}`);
        }

        const pcm: Buffer = Buffer.from(await response.arrayBuffer());
        return {
            pcm: pcm,
            sampleRate: OPENAI_OUTPUT_SAMPLE_RATE,
            channels: 1,
        };
    }
}
