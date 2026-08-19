import type { Platform, Session, WsEvent } from '@audiomesh/schemas';
import { Api } from '../Net/Api.js';
import { WsClient } from '../Net/WsClient.js';
import { esc, stateClass } from '../Util/Html.js';
import type { IPage } from './IPage.js';

/**
 * Sessions page. Start-form + live table of sessions; "Open" drills into a detail
 * view with the participant list and a live transcript pane that appends
 * partial/final transcript events straight from the WebSocket. The table refreshes
 * on any session/participant WS event (no polling loop needed).
 */
export class Sessions implements IPage {

    private _container: JQuery | null = null;
    private _openSessionId: string | null = null;
    private readonly _onEvent: (event: WsEvent) => void;

    public constructor() {
        this._onEvent = (event: WsEvent): void => this._handleEvent(event);
    }

    public async mount(container: JQuery): Promise<void> {
        this._container = container;
        container.html(Sessions._template());
        WsClient.getInstance().onAny(this._onEvent);

        container.find('#am-start-btn').on('click', async (): Promise<void> => this._start());
        container.find('.am-back').on('click', (): void => {
            this._openSessionId = null;
            void this._refreshTable();
        });
        await this._loadPlatforms();
        await this._refreshTable();
    }

    public unmount(): void {
        WsClient.getInstance().offAny(this._onEvent);
    }

    private async _loadPlatforms(): Promise<void> {
        const platforms: Platform[] = await Api.platforms();
        const select: JQuery | undefined = this._container?.find('#am-start-platform');
        if (select === undefined) {
            return;
        }
        const enabled: Platform[] = platforms.filter((p: Platform): boolean => p.enabled);
        select.html(
            enabled
                .map((p: Platform): string => `<option value="${esc(p.id)}">${esc(p.name)} (${esc(p.kind)})</option>`)
                .join(''),
        );
    }

    private async _start(): Promise<void> {
        const c: JQuery | null = this._container;
        if (c === null) {
            return;
        }
        const platformId: string = String(c.find('#am-start-platform').val() ?? '');
        const channelId: string = String(c.find('#am-start-channel').val() ?? '').trim();
        if (platformId.length === 0 || channelId.length === 0) {
            return;
        }
        const transcription: boolean = c.find('#am-start-transcription').is(':checked');
        try {
            await Api.sessionStart({ platformId: platformId, channelId: channelId, transcriptionEnabled: transcription });
            c.find('#am-start-channel').val('');
            await this._refreshTable();
        } catch (err) {
            window.alert(`Start failed: ${(err as Error).message}`);
        }
    }

    private async _stop(sessionId: string): Promise<void> {
        await Api.sessionStop(sessionId);
        if (this._openSessionId === sessionId) {
            this._openSessionId = null;
        }
        await this._refreshTable();
    }

    private _throttle: number | null = null;

    private _handleEvent(event: WsEvent): void {
        if (
            event.type === 'transcript.partial' ||
            event.type === 'transcript.final'
        ) {
            if (this._openSessionId !== null && event.sessionId === this._openSessionId) {
                this._appendTranscript(event);
            }
            return;
        }
        // Any session/participant change → refresh the table (throttled).
        if (this._throttle !== null) {
            return;
        }
        this._throttle = window.setTimeout((): void => {
            this._throttle = null;
            void this._refreshTable();
        }, 250);
    }

    private async _refreshTable(): Promise<void> {
        const c: JQuery | null = this._container;
        if (c === null) {
            return;
        }
        const sessions: Session[] = await Api.sessions();
        if (this._openSessionId !== null) {
            const open: Session | undefined = sessions.find((s: Session): boolean => s.sessionId === this._openSessionId);
            if (open !== undefined) {
                this._renderDetail(open);
                return;
            }
            this._openSessionId = null;
        }
        c.find('#am-detail').hide();
        c.find('#am-list').show();
        const body: JQuery = c.find('#am-sessions-body');
        if (sessions.length === 0) {
            body.html('<tr><td colspan="6" class="text-muted">No active sessions.</td></tr>');
            return;
        }
        body.html(
            sessions
                .map((s: Session): string => {
                    const uptime: string = s.connectedAt !== undefined
                        ? `${Math.round((Date.now() - s.connectedAt) / 1000)}s`
                        : '–';
                    return `<tr>
                        <td><code>${esc(s.sessionId.slice(0, 8))}</code></td>
                        <td>${esc(s.platform)} / ${esc(s.channelName)}</td>
                        <td><span class="badge badge-${stateClass(s.connectionState)}">${esc(s.connectionState)}</span></td>
                        <td>${s.participants.length}</td>
                        <td>${uptime}</td>
                        <td>
                            <button class="btn btn-xs btn-primary am-open" data-id="${esc(s.sessionId)}">Open</button>
                            <button class="btn btn-xs btn-danger am-stop" data-id="${esc(s.sessionId)}">Stop</button>
                        </td>
                    </tr>`;
                })
                .join(''),
        );
        body.find('.am-open').on('click', (ev: JQuery.ClickEvent): void => {
            this._openSessionId = String($(ev.currentTarget).data('id'));
            void this._refreshTable();
        });
        body.find('.am-stop').on('click', (ev: JQuery.ClickEvent): void => {
            void this._stop(String($(ev.currentTarget).data('id')));
        });
    }

    private _renderDetail(session: Session): void {
        const c: JQuery | null = this._container;
        if (c === null) {
            return;
        }
        c.find('#am-list').hide();
        const detail: JQuery = c.find('#am-detail').show();
        const participants: string = session.participants
            .map((p): string => `<li>${esc(p.displayName)} <span class="badge badge-${p.speakingState === 'speaking' ? 'success' : 'secondary'}">${esc(p.speakingState)}</span></li>`)
            .join('');
        detail.find('#am-detail-title').html(
            `${esc(session.platform)} / ${esc(session.channelName)} <span class="badge badge-${stateClass(session.connectionState)}">${esc(session.connectionState)}</span>`,
        );
        detail.find('#am-detail-participants').html(participants);
        // Transcript pane is append-only from WS; only clear it when (re)opening a
        // different session, not on every table refresh.
        if (detail.data('for') !== session.sessionId) {
            detail.data('for', session.sessionId);
            detail.find('#am-transcript').empty();
        }
    }

    private _appendTranscript(event: Extract<WsEvent, { type: 'transcript.partial' | 'transcript.final' }>): void {
        const pane: JQuery | undefined = this._container?.find('#am-transcript');
        if (pane === undefined) {
            return;
        }
        const who: string = event.line.speakerName ?? event.line.speakerId;
        const cls: string = event.line.final ? 'am-final' : 'am-partial';
        pane.append(`<div class="${cls}"><strong>${esc(who)}:</strong> ${esc(event.line.text)}</div>`);
        pane.scrollTop(pane.prop('scrollHeight') as number);
    }

    private static _template(): string {
        return `
        <section class="content"><div class="container-fluid">
            <div id="am-list">
                <div class="card"><div class="card-header"><h3 class="card-title">Start a session</h3></div>
                    <div class="card-body">
                        <div class="form-row align-items-end">
                            <div class="col-md-4"><label>Platform</label><select id="am-start-platform" class="form-control"></select></div>
                            <div class="col-md-4"><label>Channel</label><input id="am-start-channel" class="form-control" placeholder="general" /></div>
                            <div class="col-md-2"><div class="form-check"><input id="am-start-transcription" type="checkbox" class="form-check-input" /><label class="form-check-label">Transcription</label></div></div>
                            <div class="col-md-2"><button id="am-start-btn" class="btn btn-primary btn-block">Start</button></div>
                        </div>
                    </div>
                </div>
                <div class="card"><div class="card-header"><h3 class="card-title">Sessions</h3></div>
                    <div class="card-body p-0">
                        <table class="table table-hover">
                            <thead><tr><th>ID</th><th>Platform / Channel</th><th>State</th><th>Participants</th><th>Uptime</th><th>Actions</th></tr></thead>
                            <tbody id="am-sessions-body"></tbody>
                        </table>
                    </div>
                </div>
            </div>
            <div id="am-detail" style="display:none">
                <button class="btn btn-sm btn-secondary mb-2 am-back">&larr; Back</button>
                <div class="card"><div class="card-header"><h3 class="card-title" id="am-detail-title"></h3></div>
                    <div class="card-body">
                        <div class="row">
                            <div class="col-md-4"><h6>Participants</h6><ul id="am-detail-participants" class="am-participants"></ul></div>
                            <div class="col-md-8"><h6>Live Transcript</h6><div id="am-transcript" class="am-transcript"></div></div>
                        </div>
                    </div>
                </div>
            </div>
        </div></section>`;
    }

}
