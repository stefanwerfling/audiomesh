import type { Participant, Platform, Session, Settings, WsEvent } from '@audiomesh/schemas';
import { Api } from '../Net/Api.js';
import { WsClient } from '../Net/WsClient.js';
import { esc, stateClass } from '../Util/Html.js';
import type { IPage } from './IPage.js';

/** STT status pill state derived for the open session's header. */
interface SttStatus {
    text: string;
    cls: string;
    title: string;
}

/**
 * Sessions page. Start-form + live table of sessions; "Open" drills into a detail
 * view with the participant list and a live transcript pane. Everything in the
 * detail updates straight from the WebSocket with no polling:
 *
 *  - interim (`transcript.partial`) results update one line *per speaker* in place
 *    (a live "typing" line), and a `transcript.final` commits it and clears the
 *    partial — so the pane isn't flooded with every hypothesis;
 *  - `speech.started` / `speech.stopped` toggle each participant's speaking badge
 *    directly (no table refresh);
 *  - a status pill reflects the transcription/OpenAI state and any live STT error.
 */
export class Sessions implements IPage {
    private _container: JQuery | null = null;
    private _openSessionId: string | null = null;
    private _openaiConfigured: boolean = false;
    private readonly _sttError: Map<string, string> = new Map();
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
        await this._loadSettings();
        await this._loadPlatforms();
        await this._refreshTable();
    }

    public unmount(): void {
        WsClient.getInstance().offAny(this._onEvent);
    }

    private async _loadSettings(): Promise<void> {
        try {
            const settings: Settings = await Api.settings();
            this._openaiConfigured = settings.openai.apiKeyConfigured;
        } catch {
            this._openaiConfigured = false;
        }
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
                .map(
                    (p: Platform): string =>
                        `<option value="${esc(p.id)}">${esc(p.name)} (${esc(p.kind)})</option>`,
                )
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
            await Api.sessionStart({
                platformId: platformId,
                channelId: channelId,
                transcriptionEnabled: transcription,
            });
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
        this._sttError.delete(sessionId);
        await this._refreshTable();
    }

    private _throttle: number | null = null;

    private _handleEvent(event: WsEvent): void {
        // Detail-only, high-frequency events: handle directly, never trigger a
        // full table refresh (which would re-fetch and re-render the whole view).
        if (event.type === 'transcript.partial' || event.type === 'transcript.final') {
            if (this._isOpen(event.sessionId)) {
                this._onTranscript(event);
            }
            return;
        }
        if (event.type === 'speech.started' || event.type === 'speech.stopped') {
            if (this._isOpen(event.sessionId)) {
                this._setSpeaking(event.speakerId, event.type === 'speech.started');
            }
            return;
        }
        if (event.type === 'system.error') {
            this._onSystemError(event);
            return;
        }
        // Structural changes (join/left, session state) → throttled refresh.
        if (this._throttle !== null) {
            return;
        }
        this._throttle = window.setTimeout((): void => {
            this._throttle = null;
            void this._refreshTable();
        }, 250);
    }

    private _isOpen(sessionId: string): boolean {
        return this._openSessionId !== null && sessionId === this._openSessionId;
    }

    private async _refreshTable(): Promise<void> {
        const c: JQuery | null = this._container;
        if (c === null) {
            return;
        }
        const sessions: Session[] = await Api.sessions();
        if (this._openSessionId !== null) {
            const open: Session | undefined = sessions.find(
                (s: Session): boolean => s.sessionId === this._openSessionId,
            );
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
                    const uptime: string =
                        s.connectedAt !== undefined
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

        const stt: SttStatus = this._sttStatus(session);
        detail
            .find('#am-detail-title')
            .html(
                `${esc(session.platform)} / ${esc(session.channelName)} ` +
                    `<span class="badge badge-${stateClass(session.connectionState)}">${esc(session.connectionState)}</span> ` +
                    `<span class="badge badge-${stt.cls} am-stt-pill" title="${esc(stt.title)}">${esc(stt.text)}</span>`,
            );
        detail
            .find('#am-detail-participants')
            .html(
                session.participants
                    .map((p: Participant): string => Sessions._participantLi(p))
                    .join(''),
            );

        // Transcript/partials survive table refreshes; only reset when switching to
        // a different session.
        if (detail.data('for') !== session.sessionId) {
            detail.data('for', session.sessionId);
            detail.find('#am-tx-final').empty();
            detail.find('#am-tx-partials').empty();
        }
    }

    private static _participantLi(p: Participant): string {
        const speaking: boolean = p.speakingState === 'speaking';
        return `<li data-speaker="${esc(p.platformUserId)}">${esc(p.displayName)}
            <span class="badge badge-${speaking ? 'success' : 'secondary'} am-speak-badge">${speaking ? 'speaking' : 'silent'}</span></li>`;
    }

    private _setSpeaking(speakerId: string, speaking: boolean): void {
        const li: JQuery | null = this._findBySpeaker('#am-detail-participants li', speakerId);
        if (li === null) {
            return;
        }
        li.find('.am-speak-badge')
            .removeClass('badge-success badge-secondary')
            .addClass(speaking ? 'badge-success' : 'badge-secondary')
            .text(speaking ? 'speaking' : 'silent');
    }

    private _onTranscript(
        event: Extract<WsEvent, { type: 'transcript.partial' | 'transcript.final' }>,
    ): void {
        // A transcript arriving means STT is alive again — drop any stale error.
        if (this._sttError.delete(event.sessionId)) {
            this._refreshSttPill(event.sessionId);
        }
        const who: string = event.line.speakerName ?? event.line.speakerId;
        if (event.type === 'transcript.partial') {
            this._upsertPartial(event.line.speakerId, who, event.line.text);
        } else {
            this._removePartial(event.line.speakerId);
            const pane: JQuery | undefined = this._container?.find('#am-tx-final');
            pane?.append(
                `<div class="am-final"><strong>${esc(who)}:</strong> ${esc(event.line.text)}</div>`,
            );
            this._scrollTranscript();
        }
    }

    private _upsertPartial(speakerId: string, who: string, text: string): void {
        const partials: JQuery | undefined = this._container?.find('#am-tx-partials');
        if (partials === undefined) {
            return;
        }
        let line: JQuery | null = this._findBySpeaker('#am-tx-partials .am-partial', speakerId);
        if (line === null) {
            partials.append(`<div class="am-partial" data-speaker="${esc(speakerId)}"></div>`);
            line = this._findBySpeaker('#am-tx-partials .am-partial', speakerId);
        }
        line?.html(`<strong>${esc(who)}:</strong> ${esc(text)}`);
        this._scrollTranscript();
    }

    private _removePartial(speakerId: string): void {
        this._findBySpeaker('#am-tx-partials .am-partial', speakerId)?.remove();
    }

    private _scrollTranscript(): void {
        const pane: JQuery | undefined = this._container?.find('#am-transcript');
        pane?.scrollTop(pane.prop('scrollHeight') as number);
    }

    /** Find the element under `selector` whose `data-speaker` equals `speakerId`. */
    private _findBySpeaker(selector: string, speakerId: string): JQuery | null {
        const nodes: JQuery | undefined = this._container?.find(selector);
        if (nodes === undefined) {
            return null;
        }
        let found: JQuery | null = null;
        nodes.each((_: number, el: HTMLElement): void => {
            if ($(el).attr('data-speaker') === speakerId) {
                found = $(el);
            }
        });
        return found;
    }

    private _onSystemError(event: Extract<WsEvent, { type: 'system.error' }>): void {
        const isStt: boolean =
            /transcription|openai/i.test(event.component) && event.sessionId !== undefined;
        if (!isStt || event.sessionId === undefined) {
            return;
        }
        this._sttError.set(event.sessionId, event.message);
        this._refreshSttPill(event.sessionId);
    }

    /**
     * Update just the STT pill in place (no full re-render). Called when a live
     * error is recorded or cleared. Transcription is known to be enabled here (a
     * transcript or STT error for this session arrived), so the pill flips between
     * the error and the active state.
     */
    private _refreshSttPill(sessionId: string): void {
        const pill: JQuery | undefined = this._container?.find('.am-stt-pill');
        if (!this._isOpen(sessionId) || pill === undefined) {
            return;
        }
        const error: string | undefined = this._sttError.get(sessionId);
        pill.removeClass('badge-success badge-secondary badge-warning badge-danger');
        if (error !== undefined) {
            pill.addClass('badge-danger').attr('title', error).text('STT error');
        } else {
            pill.addClass('badge-success').attr('title', 'transcription active').text('STT active');
        }
    }

    private _sttStatus(session: Session): SttStatus {
        if (!session.transcriptionEnabled) {
            return { text: 'STT off', cls: 'secondary', title: 'transcription not enabled' };
        }
        const error: string | undefined = this._sttError.get(session.sessionId);
        if (error !== undefined) {
            return { text: 'STT error', cls: 'danger', title: error };
        }
        if (!this._openaiConfigured) {
            return {
                text: 'STT: no OpenAI key',
                cls: 'warning',
                title: 'configure a key in Settings',
            };
        }
        return { text: 'STT active', cls: 'success', title: 'transcription active' };
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
                            <div class="col-md-8"><h6>Live Transcript</h6>
                                <div id="am-transcript" class="am-transcript">
                                    <div id="am-tx-final"></div>
                                    <div id="am-tx-partials"></div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div></section>`;
    }
}
