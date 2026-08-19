import { Router } from 'express';
import { DefaultRoute } from 'figtree';
import { MetricsSchema, LogListSchema, type Metrics, type LogList } from '@audiomesh/schemas';
import { MetricsCollector } from '../../Core/MetricsCollector.js';
import { AudioRouter } from '../../Routing/AudioRouter.js';
import { VoiceSessionManager } from '../../Session/VoiceSessionManager.js';

/**
 * System observability endpoints:
 *  - `GET /api/v1/system/metrics` — dashboard tiles (sessions, participants,
 *    routes, audio rate, memory, ...).
 *  - `GET /api/v1/system/logs` — recent structured log/event entries for the
 *    frontend log panel. Empty for the MVP (log buffering lands with real
 *    subsystems); the shape is fixed so the UI can be built against it now.
 */
export class SystemRoute extends DefaultRoute {

    public constructor() {
        super();
        this._uriBase = '/api/';
    }

    public metrics(): Metrics {
        const sessions = VoiceSessionManager.getInstance().list();
        const participants: number = sessions.reduce(
            (sum: number, s): number => sum + s.participants.length,
            0,
        );
        return MetricsCollector.getInstance().snapshot(
            sessions.length,
            participants,
            AudioRouter.getInstance().runningCount(),
        );
    }

    public logs(): LogList {
        return { entries: [] };
    }

    public override getExpressRouter(): Router {
        this._get(
            this._getUrl('v1', 'system', 'metrics'),
            false,
            async (_req, _res, _data): Promise<Metrics> => this.metrics(),
            {
                description: 'Runtime metrics snapshot.',
                tags: ['system'],
                responseBodySchema: MetricsSchema,
            },
        );
        this._get(
            this._getUrl('v1', 'system', 'logs'),
            false,
            async (_req, _res, _data): Promise<LogList> => this.logs(),
            {
                description: 'Recent structured log/event entries.',
                tags: ['system'],
                responseBodySchema: LogListSchema,
            },
        );
        return super.getExpressRouter();
    }

}
