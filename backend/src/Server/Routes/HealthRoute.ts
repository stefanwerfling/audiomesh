import { Router } from 'express';
import { DefaultRoute } from 'figtree';
import { HealthSchema, type Health } from '@audiomesh/schemas';
import { AUDIOMESH_VERSION } from '../../version.js';

/**
 * Liveness endpoint. `GET /api/v1/system/health` — no auth, used by the frontend
 * status widget and by Docker/compose healthchecks.
 */
export class HealthRoute extends DefaultRoute {

    public constructor() {
        super();
        this._uriBase = '/api/';
    }

    public async health(): Promise<Health> {
        return {
            ok: true,
            version: AUDIOMESH_VERSION,
            uptimeSeconds: Math.round(process.uptime()),
        };
    }

    public override getExpressRouter(): Router {
        this._get(
            this._getUrl('v1', 'system', 'health'),
            false,
            async (_req, _res, _data): Promise<Health> => this.health(),
            {
                description: 'Liveness + version + uptime.',
                tags: ['system'],
                responseBodySchema: HealthSchema,
            },
        );
        return super.getExpressRouter();
    }

}
