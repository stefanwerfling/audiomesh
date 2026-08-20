import type { Platform, PlatformBody, PlatformKind } from '@audiomesh/schemas';
import { Api } from '../Net/Api.js';
import { esc } from '../Util/Html.js';
import type { IPage } from './IPage.js';

/**
 * Platforms page: one card per configured platform with enable + test + delete,
 * plus an add/edit form. When the kind is `jitsi`, per-kind config fields appear
 * (domain, display name, muted-on-join, plus advanced BOSH/WebSocket/auth) so a
 * real Jitsi server can be entered. Secrets are submitted here; the room a bot
 * joins is not platform config — it is the session's "Channel" on the Sessions
 * page.
 */
export class Platforms implements IPage {
    private static readonly KINDS: PlatformKind[] = ['mock', 'discord', 'teamspeak', 'jitsi'];

    private _container: JQuery | null = null;
    private _editId: string | null = null;

    public async mount(container: JQuery): Promise<void> {
        this._container = container;
        container.html(Platforms._template());
        container.find('#am-add-kind').on('change', (): void => this._syncKindFields());
        container.find('#am-add-btn').on('click', async (): Promise<void> => this._save());
        container.find('#am-add-reset').on('click', (): void => this._resetForm());
        this._syncKindFields();
        await this._refresh();
    }

    public unmount(): void {
        // no timers/subscriptions
    }

    /** Show the Jitsi config fieldset only when the selected kind needs it. */
    private _syncKindFields(): void {
        const kind: string = String(this._container?.find('#am-add-kind').val() ?? 'mock');
        this._container?.find('#am-jitsi-config').toggle(kind === 'jitsi');
    }

    private _readConfig(kind: PlatformKind): Record<string, unknown> | undefined {
        if (kind !== 'jitsi') {
            return undefined;
        }
        const c: JQuery | null = this._container;
        const val = (sel: string): string => String(c?.find(sel).val() ?? '').trim();
        // Accept a whole pasted meeting URL (https://host/room) and keep only the
        // host as the domain — the room is the session Channel, not platform config.
        const config: Record<string, unknown> = { domain: Platforms._host(val('#am-j-domain')) };
        const optional: Record<string, string> = {
            displayName: val('#am-j-name'),
            mucDomain: val('#am-j-muc'),
            bosh: val('#am-j-bosh'),
            websocket: val('#am-j-ws'),
            authUser: val('#am-j-user'),
            authPassword: val('#am-j-pass'),
        };
        for (const [key, value] of Object.entries(optional)) {
            if (value.length > 0) {
                config[key] = value;
            }
        }
        config['startMuted'] = c?.find('#am-j-muted').is(':checked') ?? true;
        return config;
    }

    private async _save(): Promise<void> {
        const c: JQuery | null = this._container;
        if (c === null) {
            return;
        }
        const kind: PlatformKind = String(c.find('#am-add-kind').val() ?? 'mock') as PlatformKind;
        const name: string = String(c.find('#am-add-name').val() ?? '').trim();
        if (name.length === 0) {
            window.alert('A name is required.');
            return;
        }
        if (kind === 'jitsi' && String(c.find('#am-j-domain').val() ?? '').trim().length === 0) {
            window.alert('Jitsi needs a domain, e.g. meet.example.com');
            return;
        }
        const body: PlatformBody = { kind: kind, name: name, enabled: true };
        const config: Record<string, unknown> | undefined = this._readConfig(kind);
        if (config !== undefined) {
            body.config = config;
        }
        try {
            if (this._editId !== null) {
                await Api.platformUpdate(this._editId, body);
            } else {
                await Api.platformCreate(body);
            }
            this._resetForm();
            await this._refresh();
        } catch (err) {
            window.alert(`Save failed: ${(err as Error).message}`);
        }
    }

    private _resetForm(): void {
        const c: JQuery | null = this._container;
        if (c === null) {
            return;
        }
        this._editId = null;
        c.find(
            '#am-add-name, #am-j-domain, #am-j-name, #am-j-muc, #am-j-bosh, #am-j-ws, #am-j-user, #am-j-pass',
        ).val('');
        c.find('#am-j-muted').prop('checked', true);
        c.find('#am-add-btn').text('Add');
        c.find('#am-add-reset').hide();
        this._syncKindFields();
    }

    private _edit(p: Platform): void {
        const c: JQuery | null = this._container;
        if (c === null) {
            return;
        }
        this._editId = p.id;
        const cfg: Record<string, unknown> =
            (p.config as Record<string, unknown> | undefined) ?? {};
        const s = (k: string): string => (typeof cfg[k] === 'string' ? (cfg[k] as string) : '');
        c.find('#am-add-kind').val(p.kind);
        c.find('#am-add-name').val(p.name);
        c.find('#am-j-domain').val(s('domain'));
        c.find('#am-j-name').val(s('displayName'));
        c.find('#am-j-muc').val(s('mucDomain'));
        c.find('#am-j-bosh').val(s('bosh'));
        c.find('#am-j-ws').val(s('websocket'));
        c.find('#am-j-user').val(s('authUser'));
        c.find('#am-j-pass').val(s('authPassword'));
        c.find('#am-j-muted').prop('checked', cfg['startMuted'] !== false);
        c.find('#am-add-btn').text('Update');
        c.find('#am-add-reset').show();
        this._syncKindFields();
        c.find('#am-add-name')[0]?.scrollIntoView({ behavior: 'smooth' });
    }

    private async _refresh(): Promise<void> {
        const c: JQuery | null = this._container;
        if (c === null) {
            return;
        }
        const platforms: Platform[] = await Api.platforms();
        const grid: JQuery = c.find('#am-platform-grid');
        if (platforms.length === 0) {
            grid.html('<p class="text-muted">No platforms configured yet.</p>');
            return;
        }
        grid.html(platforms.map((p: Platform): string => Platforms._card(p)).join(''));
        grid.find('.am-test').on('click', (ev: JQuery.ClickEvent): void => {
            void this._test(String($(ev.currentTarget).data('id')));
        });
        grid.find('.am-edit').on('click', (ev: JQuery.ClickEvent): void => {
            const id: string = String($(ev.currentTarget).data('id'));
            const p: Platform | undefined = platforms.find((x: Platform): boolean => x.id === id);
            if (p !== undefined) {
                this._edit(p);
            }
        });
        grid.find('.am-delete').on('click', (ev: JQuery.ClickEvent): void => {
            void this._delete(String($(ev.currentTarget).data('id')));
        });
    }

    private async _test(id: string): Promise<void> {
        const badge: JQuery | undefined = this._container?.find(`#am-test-${id}`);
        badge?.text('testing…').removeClass('text-success text-danger');
        try {
            const result = await Api.platformTest(id);
            badge
                ?.text(result.message)
                .removeClass('text-success text-danger')
                .addClass(result.ok ? 'text-success' : 'text-danger');
        } catch (err) {
            badge?.text((err as Error).message).addClass('text-danger');
        }
    }

    private async _delete(id: string): Promise<void> {
        if (this._editId === id) {
            this._resetForm();
        }
        await Api.platformDelete(id);
        await this._refresh();
    }

    /** Extract just the host from a bare host or a full meeting URL. */
    private static _host(input: string): string {
        const raw: string = input.trim();
        if (raw.length === 0) {
            return '';
        }
        try {
            return new URL(raw.includes('://') ? raw : `https://${raw}`).host;
        } catch {
            return raw.replace(/^[a-z]+:\/\//i, '').replace(/\/.*$/, '');
        }
    }

    private static _card(p: Platform): string {
        const cfg: Record<string, unknown> =
            (p.config as Record<string, unknown> | undefined) ?? {};
        const domain: string = typeof cfg['domain'] === 'string' ? (cfg['domain'] as string) : '';
        const detail: string =
            domain.length > 0 ? `<p class="mb-1"><strong>Server:</strong> ${esc(domain)}</p>` : '';
        return `
        <div class="col-md-4">
            <div class="card">
                <div class="card-header">
                    <h3 class="card-title">${esc(p.name)}</h3>
                    <span class="badge badge-${p.enabled ? 'success' : 'secondary'} float-right">${p.enabled ? 'enabled' : 'disabled'}</span>
                </div>
                <div class="card-body">
                    <p class="mb-1"><strong>Kind:</strong> ${esc(p.kind)}</p>
                    ${detail}
                    <p class="mb-2"><small id="am-test-${esc(p.id)}" class="text-muted">not tested</small></p>
                    <button class="btn btn-xs btn-info am-test" data-id="${esc(p.id)}">Test Connection</button>
                    <button class="btn btn-xs btn-secondary am-edit" data-id="${esc(p.id)}">Edit</button>
                    <button class="btn btn-xs btn-danger am-delete" data-id="${esc(p.id)}">Delete</button>
                </div>
            </div>
        </div>`;
    }

    private static _template(): string {
        const options: string = Platforms.KINDS.map(
            (k: PlatformKind): string => `<option value="${k}">${k}</option>`,
        ).join('');
        return `
        <section class="content"><div class="container-fluid">
            <div class="card"><div class="card-header"><h3 class="card-title">Add / edit platform</h3></div>
                <div class="card-body">
                    <div class="form-row align-items-end">
                        <div class="col-md-4"><label>Kind</label><select id="am-add-kind" class="form-control">${options}</select></div>
                        <div class="col-md-6"><label>Name</label><input id="am-add-name" class="form-control" placeholder="My Jitsi" /></div>
                        <div class="col-md-2">
                            <button id="am-add-btn" class="btn btn-primary btn-block">Add</button>
                            <button id="am-add-reset" class="btn btn-link btn-block p-0" style="display:none">cancel edit</button>
                        </div>
                    </div>
                    <div id="am-jitsi-config" style="display:none">
                        <hr />
                        <div class="form-row">
                            <div class="col-md-5"><label>Domain <span class="text-danger">*</span></label><input id="am-j-domain" class="form-control" placeholder="meet.example.com" /></div>
                            <div class="col-md-5"><label>Bot display name</label><input id="am-j-name" class="form-control" placeholder="AudioMesh" /></div>
                            <div class="col-md-2"><div class="form-check mt-4"><input id="am-j-muted" type="checkbox" class="form-check-input" checked /><label class="form-check-label">Join muted</label></div></div>
                        </div>
                        <details class="mt-2"><summary class="text-muted">Advanced (BOSH / WebSocket / auth)</summary>
                            <div class="form-row mt-2">
                                <div class="col-md-4"><label>MUC domain</label><input id="am-j-muc" class="form-control" placeholder="conference.meet.example.com" /></div>
                                <div class="col-md-4"><label>BOSH URL</label><input id="am-j-bosh" class="form-control" placeholder="https://meet.example.com/http-bind" /></div>
                                <div class="col-md-4"><label>XMPP WebSocket URL</label><input id="am-j-ws" class="form-control" placeholder="wss://meet.example.com/xmpp-websocket" /></div>
                            </div>
                            <div class="form-row">
                                <div class="col-md-4"><label>Auth user</label><input id="am-j-user" class="form-control" /></div>
                                <div class="col-md-4"><label>Auth password</label><input id="am-j-pass" type="password" class="form-control" /></div>
                            </div>
                        </details>
                    </div>
                    <small class="text-muted d-block mt-2">The room to join is the <strong>Channel</strong> on the Sessions page — not part of platform config. Live Jitsi also needs the optional runtime deps installed (see CONFIGURATION.md).</small>
                </div>
            </div>
            <div class="row" id="am-platform-grid"></div>
        </div></section>`;
    }
}
