import type { Health, Metrics, Session, Settings, WsEvent } from '@audiomesh/schemas';
import { Api } from '../Net/Api.js';
import { WsClient } from '../Net/WsClient.js';
import { esc } from '../Util/Html.js';
import type { IPage } from './IPage.js';

/**
 * Dashboard: infrastructure overview. Hero tiles (sessions, participants, routes,
 * audio rate), OpenAI + WS status, and a live event feed fed straight from the
 * WebSocket — so the page reflects reality without polling (metrics tiles refresh
 * on a slow timer only as a fallback).
 */
export class Dashboard implements IPage {

    private static readonly REFRESH_MS: number = 5000;

    private _container: JQuery | null = null;
    private _timer: number | null = null;
    private readonly _onEvent: (event: WsEvent) => void;
    private readonly _onStatus: (connected: boolean) => void;

    public constructor() {
        this._onEvent = (event: WsEvent): void => this._pushEvent(event);
        this._onStatus = (connected: boolean): void => this._setWsStatus(connected);
    }

    public async mount(container: JQuery): Promise<void> {
        this._container = container;
        container.html(Dashboard._template());

        WsClient.getInstance().onAny(this._onEvent);
        WsClient.getInstance().onStatus(this._onStatus);

        await this._refresh();
        this._timer = window.setInterval((): void => {
            void this._refresh();
        }, Dashboard.REFRESH_MS);
    }

    public unmount(): void {
        if (this._timer !== null) {
            window.clearInterval(this._timer);
            this._timer = null;
        }
        WsClient.getInstance().offAny(this._onEvent);
        WsClient.getInstance().offStatus(this._onStatus);
    }

    private async _refresh(): Promise<void> {
        try {
            const [metrics, sessions, settings, health]: [Metrics, Session[], Settings, Health] =
                await Promise.all([Api.metrics(), Api.sessions(), Api.settings(), Api.health()]);
            this._renderTiles(metrics, sessions, settings, health);
        } catch (err) {
            // Leave last-known values on screen; a transient fetch error is not fatal.
            window.console.error('Dashboard refresh failed:', err);
        }
    }

    private _renderTiles(metrics: Metrics, sessions: Session[], settings: Settings, health: Health): void {
        const c: JQuery | null = this._container;
        if (c === null) {
            return;
        }
        c.find('#am-tile-sessions').text(String(metrics.activeSessions));
        c.find('#am-tile-participants').text(String(metrics.participants));
        c.find('#am-tile-routes').text(String(metrics.activeRoutes));
        c.find('#am-tile-rate').text(`${metrics.audioPacketsPerSecond}/s`);
        c.find('#am-tile-mem').text(`${metrics.memoryMb} MB`);
        c.find('#am-tile-version').text(health.version);

        const openaiOk: boolean = settings.openai.apiKeyConfigured;
        c.find('#am-openai-status')
            .removeClass('badge-success badge-secondary')
            .addClass(openaiOk ? 'badge-success' : 'badge-secondary')
            .text(openaiOk ? 'Configured' : 'Not configured');

        const connected: number = sessions.filter((s: Session): boolean => s.connectionState === 'connected').length;
        c.find('#am-tile-connected').text(String(connected));
    }

    private _setWsStatus(connected: boolean): void {
        this._container
            ?.find('#am-ws-status')
            .removeClass('badge-success badge-danger')
            .addClass(connected ? 'badge-success' : 'badge-danger')
            .text(connected ? 'Live' : 'Offline');
    }

    private _pushEvent(event: WsEvent): void {
        const feed: JQuery | undefined = this._container?.find('#am-event-feed');
        if (feed === undefined || feed.length === 0) {
            return;
        }
        const time: string = new Date(event.timestamp).toLocaleTimeString();
        const row: string = `<div class="am-event"><span class="am-event-time">${esc(time)}</span> <span class="badge badge-info">${esc(event.type)}</span> ${esc(Dashboard._summary(event))}</div>`;
        feed.prepend(row);
        const children: JQuery = feed.children();
        if (children.length > 30) {
            children.slice(30).remove();
        }
    }

    private static _summary(event: WsEvent): string {
        if (event.type === 'participant.joined' || event.type === 'participant.left') {
            return event.participant.displayName;
        }
        if (event.type === 'session.connected' || event.type === 'session.disconnected') {
            return `${event.session.platform} / ${event.session.channelName}`;
        }
        if (event.type === 'transcript.partial' || event.type === 'transcript.final') {
            return event.line.text;
        }
        if (event.type === 'system.error') {
            return `${event.component}: ${event.message}`;
        }
        return '';
    }

    private static _tile(id: string, label: string, icon: string, color: string): string {
        return `
            <div class="col-lg-3 col-6">
                <div class="small-box bg-${color}">
                    <div class="inner"><h3 id="${id}">–</h3><p>${label}</p></div>
                    <div class="icon"><i class="fas ${icon}"></i></div>
                </div>
            </div>`;
    }

    private static _template(): string {
        return `
        <section class="content"><div class="container-fluid">
            <div class="row">
                ${Dashboard._tile('am-tile-sessions', 'Active Sessions', 'fa-satellite-dish', 'primary')}
                ${Dashboard._tile('am-tile-participants', 'Participants', 'fa-users', 'info')}
                ${Dashboard._tile('am-tile-routes', 'Active Routes', 'fa-diagram-project', 'success')}
                ${Dashboard._tile('am-tile-rate', 'Audio Rate', 'fa-wave-square', 'warning')}
            </div>
            <div class="row">
                <div class="col-md-6">
                    <div class="card"><div class="card-header"><h3 class="card-title">Status</h3></div>
                        <div class="card-body">
                            <table class="table table-sm am-status-table">
                                <tr><td>WebSocket</td><td><span id="am-ws-status" class="badge badge-secondary">…</span></td></tr>
                                <tr><td>OpenAI</td><td><span id="am-openai-status" class="badge badge-secondary">…</span></td></tr>
                                <tr><td>Connected sessions</td><td><span id="am-tile-connected">0</span></td></tr>
                                <tr><td>Memory</td><td><span id="am-tile-mem">–</span></td></tr>
                                <tr><td>Version</td><td><span id="am-tile-version">–</span></td></tr>
                            </table>
                        </div>
                    </div>
                </div>
                <div class="col-md-6">
                    <div class="card"><div class="card-header"><h3 class="card-title">Live Events</h3></div>
                        <div class="card-body am-event-feed" id="am-event-feed"></div>
                    </div>
                </div>
            </div>
        </div></section>`;
    }

}
