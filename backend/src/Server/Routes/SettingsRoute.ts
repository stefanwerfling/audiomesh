import { Router } from 'express';
import { DefaultRoute } from 'figtree';
import {
    OpenAiModelsBodySchema,
    OpenAiModelsResultSchema,
    OpenAiTestResultSchema,
    SettingsBodySchema,
    SettingsSchema,
    type OpenAiModelsBody,
    type OpenAiModelsResult,
    type OpenAiTestResult,
    type Settings,
    type SettingsBody,
} from '@audiomesh/schemas';
import { OpenAIProvider } from '../../Ai/OpenAIProvider.js';
import { ConfigStore } from '../../Store/ConfigStore.js';

/**
 * Application settings API — everything except the database is configured here
 * from the frontend. The OpenAI API key is write-only: `save` stores it, `state`
 * only ever reports `apiKeyConfigured`. `openai-test` probes connectivity without
 * exposing the key.
 */
export class SettingsRoute extends DefaultRoute {
    public constructor() {
        super();
        this._uriBase = '/api/';
    }

    public override getExpressRouter(): Router {
        this._get(
            this._getUrl('v1', 'settings', 'state'),
            false,
            async (_req, _res, _data): Promise<Settings> => ConfigStore.getInstance().getSettings(),
            {
                description: 'Read application settings (secrets redacted).',
                tags: ['settings'],
                responseBodySchema: SettingsSchema,
            },
        );
        this._post(
            this._getUrl('v1', 'settings', 'save'),
            false,
            async (req, _res, _data): Promise<Settings> =>
                ConfigStore.getInstance().saveSettings(req.body as SettingsBody),
            {
                description: 'Save application settings.',
                tags: ['settings'],
                bodySchema: SettingsBodySchema,
                responseBodySchema: SettingsSchema,
            },
        );
        this._post(
            this._getUrl('v1', 'settings', 'openai-test'),
            false,
            async (_req, _res, _data): Promise<OpenAiTestResult> => {
                const result = await new OpenAIProvider().testConnection();
                ConfigStore.getInstance().setOpenAiConnected(result.ok);
                return result;
            },
            {
                description: 'Probe OpenAI connectivity with the stored key.',
                tags: ['settings'],
                responseBodySchema: OpenAiTestResultSchema,
            },
        );
        this._post(
            this._getUrl('v1', 'settings', 'openai-models'),
            false,
            async (req, _res, _data): Promise<OpenAiModelsResult> => {
                const body: OpenAiModelsBody = req.body as OpenAiModelsBody;
                const store: ConfigStore = ConfigStore.getInstance();
                // Prefer the values being entered; fall back to the stored ones so
                // models load whether or not the key/base URL has been saved yet.
                const baseUrl: string =
                    body.baseUrl !== undefined && body.baseUrl.length > 0
                        ? body.baseUrl
                        : store.getOpenAiBaseUrl();
                const apiKey: string =
                    body.apiKey !== undefined && body.apiKey.length > 0
                        ? body.apiKey
                        : store.getOpenAiKey();
                return OpenAIProvider.listModels(baseUrl, apiKey);
            },
            {
                description:
                    'List models the configured gateway offers (for the Settings selects).',
                tags: ['settings'],
                bodySchema: OpenAiModelsBodySchema,
                responseBodySchema: OpenAiModelsResultSchema,
            },
        );
        return super.getExpressRouter();
    }
}
