import type { AgentProfile } from '@audiomesh/schemas';
import { Api } from '../Net/Api.js';
import { esc } from '../Util/Html.js';
import type { IPage } from './IPage.js';

/**
 * Agents page: agent-profile CRUD (name, system prompt, model, response mode).
 * Only the config surface exists in the MVP — the runtime voice agent (VAD → STT
 * → LLM → TTS) lands in Phase 7, after which a profile is assignable to a session.
 */
export class Agents implements IPage {

    private _container: JQuery | null = null;

    public async mount(container: JQuery): Promise<void> {
        this._container = container;
        container.html(Agents._template());
        container.find('#am-agent-add').on('click', async (): Promise<void> => this._add());
        await this._refresh();
    }

    public unmount(): void {
        // no timers/subscriptions
    }

    private async _add(): Promise<void> {
        const c: JQuery | null = this._container;
        if (c === null) {
            return;
        }
        const name: string = String(c.find('#am-agent-name').val() ?? '').trim();
        if (name.length === 0) {
            return;
        }
        await Api.agentCreate({
            name: name,
            systemPrompt: String(c.find('#am-agent-prompt').val() ?? ''),
            model: String(c.find('#am-agent-model').val() ?? 'gpt-4o'),
            responseMode: 'manual',
            enabledTools: [],
        });
        c.find('#am-agent-name').val('');
        c.find('#am-agent-prompt').val('');
        await this._refresh();
    }

    private async _refresh(): Promise<void> {
        const c: JQuery | null = this._container;
        if (c === null) {
            return;
        }
        const agents: AgentProfile[] = await Api.agents();
        const grid: JQuery = c.find('#am-agents-grid');
        if (agents.length === 0) {
            grid.html('<p class="text-muted">No agent profiles yet.</p>');
            return;
        }
        grid.html(
            agents
                .map((a: AgentProfile): string => `
                <div class="col-md-4"><div class="card"><div class="card-header">
                    <h3 class="card-title">${esc(a.name)}</h3>
                    <button class="btn btn-xs btn-danger float-right am-agent-del" data-id="${esc(a.id)}">Delete</button>
                </div><div class="card-body">
                    <p class="mb-1"><strong>Model:</strong> ${esc(a.model)}</p>
                    <p class="mb-1"><strong>Mode:</strong> ${esc(a.responseMode)}</p>
                    <p class="text-muted mb-0"><small>${esc(a.systemPrompt.slice(0, 120))}</small></p>
                </div></div></div>`)
                .join(''),
        );
        grid.find('.am-agent-del').on('click', (ev: JQuery.ClickEvent): void => {
            void Api.agentDelete(String($(ev.currentTarget).data('id'))).then((): Promise<void> => this._refresh());
        });
    }

    private static _template(): string {
        return `
        <section class="content"><div class="container-fluid">
            <div class="card"><div class="card-header"><h3 class="card-title">Create agent profile</h3></div>
                <div class="card-body">
                    <div class="form-row">
                        <div class="col-md-4 form-group"><label>Name</label><input id="am-agent-name" class="form-control" placeholder="Meeting Assistant" /></div>
                        <div class="col-md-4 form-group"><label>Model</label><input id="am-agent-model" class="form-control" value="gpt-4o" /></div>
                    </div>
                    <div class="form-group"><label>System prompt</label><textarea id="am-agent-prompt" class="form-control" rows="2"></textarea></div>
                    <button id="am-agent-add" class="btn btn-primary">Create</button>
                </div>
            </div>
            <div class="row" id="am-agents-grid"></div>
        </div></section>`;
    }

}
