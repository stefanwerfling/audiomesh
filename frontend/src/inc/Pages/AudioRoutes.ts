import type { AudioRoute } from '@audiomesh/schemas';
import { Api } from '../Net/Api.js';
import { esc, stateClass } from '../Util/Html.js';
import type { IPage } from './IPage.js';

/**
 * Audio Routes page: list + create/start/stop/delete. Routes are stored as a
 * node chain (source → processors → sink) — the model is graph-ready so the
 * future visual editor is additive. The MVP UI creates a simple named route; the
 * actual cross-platform frame-moving lands in Phase 5.
 */
export class AudioRoutes implements IPage {

    private _container: JQuery | null = null;

    public async mount(container: JQuery): Promise<void> {
        this._container = container;
        container.html(AudioRoutes._template());
        container.find('#am-route-add').on('click', async (): Promise<void> => this._add());
        await this._refresh();
    }

    public unmount(): void {
        // no timers/subscriptions
    }

    private async _add(): Promise<void> {
        const name: string = String(this._container?.find('#am-route-name').val() ?? '').trim();
        if (name.length === 0) {
            return;
        }
        await Api.routeCreate({ name: name, enabled: true, nodes: [] });
        this._container?.find('#am-route-name').val('');
        await this._refresh();
    }

    private async _refresh(): Promise<void> {
        const c: JQuery | null = this._container;
        if (c === null) {
            return;
        }
        const routes: AudioRoute[] = await Api.routes();
        const body: JQuery = c.find('#am-routes-body');
        if (routes.length === 0) {
            body.html('<tr><td colspan="4" class="text-muted">No routes yet.</td></tr>');
            return;
        }
        body.html(
            routes
                .map((r: AudioRoute): string => `<tr>
                    <td>${esc(r.name)}</td>
                    <td><span class="badge badge-${stateClass(r.state)}">${esc(r.state)}</span></td>
                    <td>${r.nodes.length} nodes</td>
                    <td>
                        <button class="btn btn-xs btn-success am-run" data-id="${esc(r.id)}">Start</button>
                        <button class="btn btn-xs btn-warning am-halt" data-id="${esc(r.id)}">Stop</button>
                        <button class="btn btn-xs btn-danger am-del" data-id="${esc(r.id)}">Delete</button>
                    </td>
                </tr>`)
                .join(''),
        );
        body.find('.am-run').on('click', (ev: JQuery.ClickEvent): void => {
            void Api.routeStart(String($(ev.currentTarget).data('id'))).then((): Promise<void> => this._refresh());
        });
        body.find('.am-halt').on('click', (ev: JQuery.ClickEvent): void => {
            void Api.routeStop(String($(ev.currentTarget).data('id'))).then((): Promise<void> => this._refresh());
        });
        body.find('.am-del').on('click', (ev: JQuery.ClickEvent): void => {
            void Api.routeDelete(String($(ev.currentTarget).data('id'))).then((): Promise<void> => this._refresh());
        });
    }

    private static _template(): string {
        return `
        <section class="content"><div class="container-fluid">
            <div class="card"><div class="card-header"><h3 class="card-title">Create route</h3></div>
                <div class="card-body"><div class="form-row align-items-end">
                    <div class="col-md-8"><label>Name</label><input id="am-route-name" class="form-control" placeholder="Discord → TeamSpeak" /></div>
                    <div class="col-md-2"><button id="am-route-add" class="btn btn-primary btn-block">Create</button></div>
                </div></div>
            </div>
            <div class="card"><div class="card-header"><h3 class="card-title">Routes</h3></div>
                <div class="card-body p-0"><table class="table table-hover">
                    <thead><tr><th>Name</th><th>State</th><th>Nodes</th><th>Actions</th></tr></thead>
                    <tbody id="am-routes-body"></tbody>
                </table></div>
            </div>
        </div></section>`;
    }

}
