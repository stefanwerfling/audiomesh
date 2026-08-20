import type { AudioRoute, RouteNode, Session, WsEvent } from '@audiomesh/schemas';
import { Api } from '../Net/Api.js';
import { WsClient } from '../Net/WsClient.js';
import { esc, stateClass } from '../Util/Html.js';
import type { IPage } from './IPage.js';

/**
 * Audio Routes page: build and run cross-platform routes. A route is a node chain
 * (source session → optional gain → sink session); the runtime moves that
 * session's mixed audio into the target session's send path. The form picks the
 * source + target sessions and an optional gain; the table shows each route's
 * readable chain and live run-state, refreshed straight from the WebSocket.
 */
export class AudioRoutes implements IPage {
    private _container: JQuery | null = null;
    private _sessions: Session[] = [];
    private readonly _onEvent: (event: WsEvent) => void;
    private _throttle: number | null = null;

    public constructor() {
        this._onEvent = (event: WsEvent): void => this._handleEvent(event);
    }

    public async mount(container: JQuery): Promise<void> {
        this._container = container;
        container.html(AudioRoutes._template());
        container.find('#am-route-add').on('click', async (): Promise<void> => this._add());
        WsClient.getInstance().onAny(this._onEvent);
        await this._refresh();
    }

    public unmount(): void {
        WsClient.getInstance().offAny(this._onEvent);
    }

    private _handleEvent(event: WsEvent): void {
        // Route + session lifecycle changes affect this page; coalesce refreshes.
        const relevant: boolean =
            event.type.startsWith('audio.route.') ||
            event.type.startsWith('session.') ||
            event.type.startsWith('participant.');
        if (!relevant || this._throttle !== null) {
            return;
        }
        this._throttle = window.setTimeout((): void => {
            this._throttle = null;
            void this._refresh();
        }, 300);
    }

    private _sessionOptions(selected?: string): string {
        if (this._sessions.length === 0) {
            return '<option value="">(no active sessions)</option>';
        }
        return this._sessions
            .map((s: Session): string => {
                const label: string = `${s.platform} / ${s.channelName} (${s.sessionId.slice(0, 8)})`;
                const sel: string = s.sessionId === selected ? ' selected' : '';
                return `<option value="${esc(s.sessionId)}"${sel}>${esc(label)}</option>`;
            })
            .join('');
    }

    private async _add(): Promise<void> {
        const c: JQuery | null = this._container;
        if (c === null) {
            return;
        }
        const name: string = String(c.find('#am-route-name').val() ?? '').trim();
        const srcId: string = String(c.find('#am-route-source').val() ?? '');
        const dstId: string = String(c.find('#am-route-sink').val() ?? '');
        const gain: number = Number(c.find('#am-route-gain').val() ?? '1');
        if (name.length === 0 || srcId.length === 0 || dstId.length === 0) {
            window.alert('Name, source and target session are required.');
            return;
        }
        const nodes: RouteNode[] = [
            { id: AudioRoutes._uid(), kind: 'source', type: 'session', ref: srcId },
        ];
        if (Number.isFinite(gain) && gain !== 1 && gain >= 0) {
            nodes.push({
                id: AudioRoutes._uid(),
                kind: 'processor',
                type: 'gain',
                ref: String(gain),
            });
        }
        nodes.push({ id: AudioRoutes._uid(), kind: 'sink', type: 'session', ref: dstId });

        await Api.routeCreate({ name: name, enabled: true, nodes: nodes });
        c.find('#am-route-name').val('');
        c.find('#am-route-gain').val('1');
        await this._refresh();
    }

    private async _refresh(): Promise<void> {
        const c: JQuery | null = this._container;
        if (c === null) {
            return;
        }
        [this._sessions] = await Promise.all([Api.sessions()]);
        const routes: AudioRoute[] = await Api.routes();

        // Keep the current selections while refilling the session dropdowns.
        const srcSel: JQuery = c.find('#am-route-source');
        const dstSel: JQuery = c.find('#am-route-sink');
        srcSel.html(this._sessionOptions(String(srcSel.val() ?? '')));
        dstSel.html(this._sessionOptions(String(dstSel.val() ?? '')));

        const body: JQuery = c.find('#am-routes-body');
        if (routes.length === 0) {
            body.html('<tr><td colspan="4" class="text-muted">No routes yet.</td></tr>');
            return;
        }
        body.html(
            routes
                .map(
                    (r: AudioRoute): string => `<tr>
                    <td>${esc(r.name)}<div class="am-route-chain">${this._chainLabel(r)}</div></td>
                    <td><span class="badge badge-${stateClass(r.state)}">${esc(r.state)}</span></td>
                    <td>${r.nodes.length} nodes</td>
                    <td>
                        <button class="btn btn-xs btn-success am-run" data-id="${esc(r.id)}">Start</button>
                        <button class="btn btn-xs btn-warning am-halt" data-id="${esc(r.id)}">Stop</button>
                        <button class="btn btn-xs btn-danger am-del" data-id="${esc(r.id)}">Delete</button>
                    </td>
                </tr>`,
                )
                .join(''),
        );
        body.find('.am-run').on('click', (ev: JQuery.ClickEvent): void => {
            void Api.routeStart(String($(ev.currentTarget).data('id'))).then((): Promise<void> =>
                this._refresh(),
            );
        });
        body.find('.am-halt').on('click', (ev: JQuery.ClickEvent): void => {
            void Api.routeStop(String($(ev.currentTarget).data('id'))).then((): Promise<void> =>
                this._refresh(),
            );
        });
        body.find('.am-del').on('click', (ev: JQuery.ClickEvent): void => {
            void Api.routeDelete(String($(ev.currentTarget).data('id'))).then((): Promise<void> =>
                this._refresh(),
            );
        });
    }

    /** Human-readable "src → ×gain → sink" for a route, resolving session names. */
    private _chainLabel(route: AudioRoute): string {
        const parts: string[] = route.nodes.map((n: RouteNode): string => {
            if (n.type === 'session') {
                return esc(this._sessionLabel(n.ref));
            }
            if (n.type === 'gain') {
                return `×${esc(n.ref ?? '1')}`;
            }
            return esc(n.type);
        });
        return parts.join(' &rarr; ');
    }

    private _sessionLabel(sessionId: string | undefined): string {
        const s: Session | undefined = this._sessions.find(
            (x: Session): boolean => x.sessionId === sessionId,
        );
        if (s === undefined) {
            return sessionId !== undefined ? `${sessionId.slice(0, 8)} (gone)` : '?';
        }
        return `${s.platform}/${s.channelName}`;
    }

    private static _uid(): string {
        return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
            ? crypto.randomUUID()
            : `n-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    }

    private static _template(): string {
        return `
        <section class="content"><div class="container-fluid">
            <div class="card"><div class="card-header"><h3 class="card-title">Create route</h3></div>
                <div class="card-body"><div class="form-row align-items-end">
                    <div class="col-md-3"><label>Name</label><input id="am-route-name" class="form-control" placeholder="Jitsi → TeamSpeak" /></div>
                    <div class="col-md-3"><label>Source session</label><select id="am-route-source" class="form-control"></select></div>
                    <div class="col-md-3"><label>Target session</label><select id="am-route-sink" class="form-control"></select></div>
                    <div class="col-md-1"><label>Gain</label><input id="am-route-gain" class="form-control" type="number" step="0.1" min="0" value="1" /></div>
                    <div class="col-md-2"><button id="am-route-add" class="btn btn-primary btn-block">Create</button></div>
                </div></div>
            </div>
            <div class="card"><div class="card-header"><h3 class="card-title">Routes</h3></div>
                <div class="card-body p-0"><table class="table table-hover">
                    <thead><tr><th>Name / Chain</th><th>State</th><th>Nodes</th><th>Actions</th></tr></thead>
                    <tbody id="am-routes-body"></tbody>
                </table></div>
            </div>
        </div></section>`;
    }
}
