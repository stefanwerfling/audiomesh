import { Router } from 'express';
import { DefaultRoute } from 'figtree';
import {
    ApiResultSchema,
    SessionListSchema,
    SessionNullableSchema,
    SessionSchema,
    SessionStartBodySchema,
    type ApiResult,
    type Session,
    type SessionStartBody,
} from '@audiomesh/schemas';
import { VoiceSessionManager } from '../../Session/VoiceSessionManager.js';

/**
 * Session lifecycle API. figtree exposes only GET/POST, so mutations are POST
 * actions rather than REST verbs:
 *  - `GET  /api/v1/sessions/list`
 *  - `GET  /api/v1/sessions/get?id=...`
 *  - `POST /api/v1/sessions/start` (body: SessionStartBody)
 *  - `POST /api/v1/sessions/stop`  (body: { sessionId })
 */
export class SessionsRoute extends DefaultRoute {

    public constructor() {
        super();
        this._uriBase = '/api/';
    }

    public override getExpressRouter(): Router {
        this._get(
            this._getUrl('v1', 'sessions', 'list'),
            false,
            async (_req, _res, _data): Promise<Session[]> => VoiceSessionManager.getInstance().list(),
            { description: 'List all live sessions.', tags: ['sessions'], responseBodySchema: SessionListSchema },
        );
        this._get(
            this._getUrl('v1', 'sessions', 'get'),
            false,
            async (req, _res, _data): Promise<Session | null> => {
                const id: string = (req.query['id'] as string | undefined) ?? '';
                return VoiceSessionManager.getInstance().get(id)?.toDto() ?? null;
            },
            { description: 'Get a single session by id.', tags: ['sessions'], responseBodySchema: SessionNullableSchema },
        );
        this._post(
            this._getUrl('v1', 'sessions', 'start'),
            false,
            async (req, _res, _data): Promise<Session> => {
                const body: SessionStartBody = req.body as SessionStartBody;
                const session = await VoiceSessionManager.getInstance().start(
                    body.platformId,
                    body.channelId,
                    body.transcriptionEnabled ?? false,
                );
                return session.toDto();
            },
            {
                description: 'Start a session on a configured platform.',
                tags: ['sessions'],
                bodySchema: SessionStartBodySchema,
                responseBodySchema: SessionSchema,
            },
        );
        this._post(
            this._getUrl('v1', 'sessions', 'stop'),
            false,
            async (req, _res, _data): Promise<ApiResult> => {
                const sessionId: string = ((req.body as { sessionId?: string }).sessionId) ?? '';
                const ok: boolean = await VoiceSessionManager.getInstance().stop(sessionId);
                return { ok: ok, message: ok ? 'stopped' : 'unknown session' };
            },
            {
                description: 'Stop a running session.',
                tags: ['sessions'],
                responseBodySchema: ApiResultSchema,
            },
        );
        return super.getExpressRouter();
    }

}
