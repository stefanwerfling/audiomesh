import type { LogList, Metrics } from '@audiomesh/schemas';
import { Api } from '../Net/Api.js';
import { esc } from '../Util/Html.js';
import type { IPage } from './IPage.js';

/**
 * System page: the full metrics table (latencies, dropped frames, reconnects,
 * queue size, memory) plus the structured log/event panel. Refreshes on a timer;
 * the values that need real subsystems read 0 until those phases land.
 */
export class System implements IPage {

    private static readonly REFRESH_MS: number = 3000;

    private _container: JQuery | null = null;
    private _timer: number | null = null;

    public async mount(container: JQuery): Promise<void> {
        this._container = container;
        container.html(System._template());
        await this._refresh();
        this._timer = window.setInterval((): void => {
            void this._refresh();
        }, System.REFRESH_MS);
    }

    public unmount(): void {
        if (this._timer !== null) {
            window.clearInterval(this._timer);
            this._timer = null;
        }
    }

    private async _refresh(): Promise<void> {
        const c: JQuery | null = this._container;
        if (c === null) {
            return;
        }
        try {
            const [metrics, logs]: [Metrics, LogList] = await Promise.all([Api.metrics(), Api.logs()]);
            const rows: Array<[string, string]> = [
                ['Active sessions', String(metrics.activeSessions)],
                ['Participants', String(metrics.participants)],
                ['Active routes', String(metrics.activeRoutes)],
                ['Audio packets/sec', String(metrics.audioPacketsPerSecond)],
                ['Audio latency (ms)', String(metrics.audioLatencyMs)],
                ['Transcription latency (ms)', String(metrics.transcriptionLatencyMs)],
                ['OpenAI latency (ms)', String(metrics.openaiLatencyMs)],
                ['Dropped frames', String(metrics.droppedFrames)],
                ['Reconnects', String(metrics.reconnects)],
                ['Queue size', String(metrics.queueSize)],
                ['Memory (MB)', String(metrics.memoryMb)],
            ];
            c.find('#am-metrics-body').html(
                rows.map(([k, v]): string => `<tr><td>${esc(k)}</td><td class="text-right">${esc(v)}</td></tr>`).join(''),
            );
            const logBody: JQuery = c.find('#am-log-body');
            if (logs.entries.length === 0) {
                logBody.html('<div class="text-muted">No log entries.</div>');
            } else {
                logBody.html(
                    logs.entries
                        .map((e): string => `<div><span class="badge badge-secondary">${esc(e.level)}</span> <code>${esc(e.component)}</code> ${esc(e.event)}</div>`)
                        .join(''),
                );
            }
        } catch (err) {
            window.console.error('System refresh failed:', err);
        }
    }

    private static _template(): string {
        return `
        <section class="content"><div class="container-fluid"><div class="row">
            <div class="col-md-6"><div class="card"><div class="card-header"><h3 class="card-title">Metrics</h3></div>
                <div class="card-body p-0"><table class="table table-sm"><tbody id="am-metrics-body"></tbody></table></div></div></div>
            <div class="col-md-6"><div class="card"><div class="card-header"><h3 class="card-title">Logs</h3></div>
                <div class="card-body am-log-body" id="am-log-body"></div></div></div>
        </div></div></section>`;
    }

}
