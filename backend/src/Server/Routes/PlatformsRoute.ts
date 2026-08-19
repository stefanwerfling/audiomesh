import { Router } from 'express';
import { DefaultRoute } from 'figtree';
import {
    ApiResultSchema,
    PlatformBodySchema,
    PlatformListSchema,
    PlatformNullableSchema,
    PlatformSchema,
    PlatformTestResultSchema,
    type ApiResult,
    type Platform,
    type PlatformBody,
    type PlatformTestResult,
} from '@audiomesh/schemas';
import { PlatformRegistry } from '../../Platform/PlatformRegistry.js';
import { ConfigStore } from '../../Store/ConfigStore.js';

/**
 * Platform management API — the frontend's Platforms page CRUD plus a connection
 * test. All config (including secrets) is edited here and persisted in the
 * `ConfigStore`; secrets are never read back. `test` builds an adapter from the
 * registry, connects, and disconnects — so "Test connection" is real even for the
 * mock.
 */
export class PlatformsRoute extends DefaultRoute {

    public constructor() {
        super();
        this._uriBase = '/api/';
    }

    public override getExpressRouter(): Router {
        this._get(
            this._getUrl('v1', 'platforms', 'list'),
            false,
            async (_req, _res, _data): Promise<Platform[]> => ConfigStore.getInstance().listPlatforms(),
            { description: 'List configured platforms.', tags: ['platforms'], responseBodySchema: PlatformListSchema },
        );
        this._post(
            this._getUrl('v1', 'platforms', 'create'),
            false,
            async (req, _res, _data): Promise<Platform> =>
                ConfigStore.getInstance().createPlatform(req.body as PlatformBody),
            {
                description: 'Create a platform.',
                tags: ['platforms'],
                bodySchema: PlatformBodySchema,
                responseBodySchema: PlatformSchema,
            },
        );
        this._post(
            this._getUrl('v1', 'platforms', 'update'),
            false,
            async (req, _res, _data): Promise<Platform | null> => {
                const id: string = (req.query['id'] as string | undefined) ?? '';
                return ConfigStore.getInstance().updatePlatform(id, req.body as PlatformBody);
            },
            {
                description: 'Update a platform by ?id=.',
                tags: ['platforms'],
                bodySchema: PlatformBodySchema,
                responseBodySchema: PlatformNullableSchema,
            },
        );
        this._post(
            this._getUrl('v1', 'platforms', 'delete'),
            false,
            async (req, _res, _data): Promise<ApiResult> => {
                const id: string = (req.query['id'] as string | undefined) ?? '';
                const ok: boolean = ConfigStore.getInstance().deletePlatform(id);
                return { ok: ok };
            },
            { description: 'Delete a platform by ?id=.', tags: ['platforms'], responseBodySchema: ApiResultSchema },
        );
        this._post(
            this._getUrl('v1', 'platforms', 'test'),
            false,
            async (req, _res, _data): Promise<PlatformTestResult> => {
                const id: string = (req.query['id'] as string | undefined) ?? '';
                return this.test(id);
            },
            {
                description: 'Test-connect a platform by ?id=.',
                tags: ['platforms'],
                responseBodySchema: PlatformTestResultSchema,
            },
        );
        return super.getExpressRouter();
    }

    public async test(id: string): Promise<PlatformTestResult> {
        const stored = ConfigStore.getInstance().getStoredPlatform(id);
        if (stored === null) {
            return { ok: false, message: `unknown platform '${id}'` };
        }
        const registry: PlatformRegistry = PlatformRegistry.getInstance();
        if (!registry.has(stored.kind)) {
            return { ok: false, message: `no adapter for kind '${stored.kind}'` };
        }
        try {
            const adapter = registry.create(stored.kind, stored.config);
            await adapter.connect();
            const connected: boolean = adapter.isConnected();
            await adapter.disconnect();
            return {
                ok: connected,
                message: connected ? 'connection ok' : 'adapter did not connect',
            };
        } catch (error: unknown) {
            return { ok: false, message: (error as Error).message };
        }
    }

}
