import { Router } from 'express';
import { DefaultRoute } from 'figtree';
import {
    ApiResultSchema,
    AudioRouteBodySchema,
    AudioRouteListSchema,
    AudioRouteNullableSchema,
    AudioRouteSchema,
    type ApiResult,
    type AudioRoute,
    type AudioRouteBody,
} from '@audiomesh/schemas';
import { AudioRouter } from '../../Routing/AudioRouter.js';
import { ConfigStore } from '../../Store/ConfigStore.js';

/**
 * Audio-route API. Route definitions are persisted in the `ConfigStore`; the live
 * run-state is owned by {@link AudioRouter}. Frame-moving across platforms is
 * Phase 5 — start/stop currently flip run-state and emit events so the UI is real.
 */
export class RoutesRoute extends DefaultRoute {
    public constructor() {
        super();
        this._uriBase = '/api/';
    }

    public override getExpressRouter(): Router {
        this._get(
            this._getUrl('v1', 'routes', 'list'),
            false,
            async (_req, _res, _data): Promise<AudioRoute[]> => this.list(),
            {
                description: 'List audio routes.',
                tags: ['routes'],
                responseBodySchema: AudioRouteListSchema,
            },
        );
        this._post(
            this._getUrl('v1', 'routes', 'create'),
            false,
            async (req, _res, _data): Promise<AudioRoute> =>
                ConfigStore.getInstance().createRoute(req.body as AudioRouteBody),
            {
                description: 'Create an audio route.',
                tags: ['routes'],
                bodySchema: AudioRouteBodySchema,
                responseBodySchema: AudioRouteSchema,
            },
        );
        this._post(
            this._getUrl('v1', 'routes', 'update'),
            false,
            async (req, _res, _data): Promise<AudioRoute | null> => {
                const id: string = (req.query['id'] as string | undefined) ?? '';
                return ConfigStore.getInstance().updateRoute(id, req.body as AudioRouteBody);
            },
            {
                description: 'Update a route by ?id=.',
                tags: ['routes'],
                bodySchema: AudioRouteBodySchema,
                responseBodySchema: AudioRouteNullableSchema,
            },
        );
        this._post(
            this._getUrl('v1', 'routes', 'delete'),
            false,
            async (req, _res, _data): Promise<ApiResult> => {
                const id: string = (req.query['id'] as string | undefined) ?? '';
                AudioRouter.getInstance().stop(id);
                return { ok: ConfigStore.getInstance().deleteRoute(id) };
            },
            {
                description: 'Delete a route by ?id=.',
                tags: ['routes'],
                responseBodySchema: ApiResultSchema,
            },
        );
        this._post(
            this._getUrl('v1', 'routes', 'start'),
            false,
            async (req, _res, _data): Promise<ApiResult> => this.setRunning(req.query['id'], true),
            {
                description: 'Start a route by ?id=.',
                tags: ['routes'],
                responseBodySchema: ApiResultSchema,
            },
        );
        this._post(
            this._getUrl('v1', 'routes', 'stop'),
            false,
            async (req, _res, _data): Promise<ApiResult> => this.setRunning(req.query['id'], false),
            {
                description: 'Stop a route by ?id=.',
                tags: ['routes'],
                responseBodySchema: ApiResultSchema,
            },
        );
        return super.getExpressRouter();
    }

    public list(): AudioRoute[] {
        const router: AudioRouter = AudioRouter.getInstance();
        return ConfigStore.getInstance()
            .listRoutes()
            .map((route: AudioRoute): AudioRoute => ({
                ...route,
                state: router.getState(route.id),
            }));
    }

    private setRunning(idRaw: unknown, run: boolean): ApiResult {
        const id: string = (idRaw as string | undefined) ?? '';
        const route: AudioRoute | undefined = ConfigStore.getInstance()
            .listRoutes()
            .find((r: AudioRoute): boolean => r.id === id);
        if (route === undefined) {
            return { ok: false, message: `unknown route '${id}'` };
        }
        if (run) {
            const ok: boolean = AudioRouter.getInstance().start(route);
            return { ok: ok, message: ok ? 'route running' : 'route failed to start (see logs)' };
        }
        AudioRouter.getInstance().stop(id);
        return { ok: true };
    }
}
