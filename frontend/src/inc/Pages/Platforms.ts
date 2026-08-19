import type { Platform, PlatformKind } from '@audiomesh/schemas';
import { Api } from '../Net/Api.js';
import { esc } from '../Util/Html.js';
import type { IPage } from './IPage.js';

/**
 * Platforms page: one card per configured platform with enable + test + delete,
 * plus an add form. Discord/TeamSpeak/Jitsi appear here as soon as their adapters
 * register — the card UI is platform-agnostic. Secrets are entered here and never
 * read back.
 */
export class Platforms implements IPage {

    private static readonly KINDS: PlatformKind[] = ['mock', 'discord', 'teamspeak', 'jitsi'];

    private _container: JQuery | null = null;

    public async mount(container: JQuery): Promise<void> {
        this._container = container;
        container.html(Platforms._template());
        container.find('#am-add-btn').on('click', async (): Promise<void> => this._add());
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
        const kind: PlatformKind = String(c.find('#am-add-kind').val() ?? 'mock') as PlatformKind;
        const name: string = String(c.find('#am-add-name').val() ?? '').trim();
        if (name.length === 0) {
            return;
        }
        await Api.platformCreate({ kind: kind, name: name, enabled: true });
        c.find('#am-add-name').val('');
        await this._refresh();
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
        grid.find('.am-delete').on('click', (ev: JQuery.ClickEvent): void => {
            void this._delete(String($(ev.currentTarget).data('id')));
        });
    }

    private async _test(id: string): Promise<void> {
        const badge: JQuery | undefined = this._container?.find(`#am-test-${id}`);
        badge?.text('testing…');
        try {
            const result = await Api.platformTest(id);
            badge?.text(result.message).removeClass('text-success text-danger').addClass(result.ok ? 'text-success' : 'text-danger');
        } catch (err) {
            badge?.text((err as Error).message).addClass('text-danger');
        }
    }

    private async _delete(id: string): Promise<void> {
        await Api.platformDelete(id);
        await this._refresh();
    }

    private static _card(p: Platform): string {
        return `
        <div class="col-md-4">
            <div class="card">
                <div class="card-header">
                    <h3 class="card-title">${esc(p.name)}</h3>
                    <span class="badge badge-${p.enabled ? 'success' : 'secondary'} float-right">${p.enabled ? 'enabled' : 'disabled'}</span>
                </div>
                <div class="card-body">
                    <p class="mb-1"><strong>Kind:</strong> ${esc(p.kind)}</p>
                    <p class="mb-2"><small id="am-test-${esc(p.id)}" class="text-muted">not tested</small></p>
                    <button class="btn btn-xs btn-info am-test" data-id="${esc(p.id)}">Test Connection</button>
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
            <div class="card"><div class="card-header"><h3 class="card-title">Add platform</h3></div>
                <div class="card-body">
                    <div class="form-row align-items-end">
                        <div class="col-md-4"><label>Kind</label><select id="am-add-kind" class="form-control">${options}</select></div>
                        <div class="col-md-6"><label>Name</label><input id="am-add-name" class="form-control" placeholder="My Discord" /></div>
                        <div class="col-md-2"><button id="am-add-btn" class="btn btn-primary btn-block">Add</button></div>
                    </div>
                    <small class="text-muted">Adapters other than <code>mock</code> land in later phases; their config fields appear here per kind.</small>
                </div>
            </div>
            <div class="row" id="am-platform-grid"></div>
        </div></section>`;
    }

}
