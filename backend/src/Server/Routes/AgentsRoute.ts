import { Router } from 'express';
import { DefaultRoute } from 'figtree';
import {
    AgentProfileBodySchema,
    AgentProfileListSchema,
    AgentProfileNullableSchema,
    AgentProfileSchema,
    ApiResultSchema,
    type AgentProfile,
    type AgentProfileBody,
    type ApiResult,
} from '@audiomesh/schemas';
import { ConfigStore } from '../../Store/ConfigStore.js';

/**
 * Agent-profile CRUD. Only the config surface exists in the MVP — the runtime
 * agent (VAD → STT → LLM → TTS) lands in Phase 7. Profiles are persisted in the
 * `ConfigStore` and later assignable to a session.
 */
export class AgentsRoute extends DefaultRoute {

    public constructor() {
        super();
        this._uriBase = '/api/';
    }

    public override getExpressRouter(): Router {
        this._get(
            this._getUrl('v1', 'agents', 'list'),
            false,
            async (_req, _res, _data): Promise<AgentProfile[]> => ConfigStore.getInstance().listAgents(),
            { description: 'List agent profiles.', tags: ['agents'], responseBodySchema: AgentProfileListSchema },
        );
        this._post(
            this._getUrl('v1', 'agents', 'create'),
            false,
            async (req, _res, _data): Promise<AgentProfile> =>
                ConfigStore.getInstance().createAgent(req.body as AgentProfileBody),
            {
                description: 'Create an agent profile.',
                tags: ['agents'],
                bodySchema: AgentProfileBodySchema,
                responseBodySchema: AgentProfileSchema,
            },
        );
        this._post(
            this._getUrl('v1', 'agents', 'update'),
            false,
            async (req, _res, _data): Promise<AgentProfile | null> => {
                const id: string = (req.query['id'] as string | undefined) ?? '';
                return ConfigStore.getInstance().updateAgent(id, req.body as AgentProfileBody);
            },
            {
                description: 'Update an agent by ?id=.',
                tags: ['agents'],
                bodySchema: AgentProfileBodySchema,
                responseBodySchema: AgentProfileNullableSchema,
            },
        );
        this._post(
            this._getUrl('v1', 'agents', 'delete'),
            false,
            async (req, _res, _data): Promise<ApiResult> => {
                const id: string = (req.query['id'] as string | undefined) ?? '';
                return { ok: ConfigStore.getInstance().deleteAgent(id) };
            },
            { description: 'Delete an agent by ?id=.', tags: ['agents'], responseBodySchema: ApiResultSchema },
        );
        return super.getExpressRouter();
    }

}
