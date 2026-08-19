import type { WsEvent } from '@audiomesh/schemas';
import { WsClient } from '../Net/WsClient.js';
import { esc } from '../Util/Html.js';
import type { IPage } from './IPage.js';

/**
 * Transcripts page: a global live feed of every transcript event across all
 * sessions, straight from the WebSocket. Per-session transcripts live in the
 * Session detail view; this is the firehose. Populates once Phase 3 (OpenAI STT)
 * starts emitting transcript events.
 */
export class Transcripts implements IPage {

    private _container: JQuery | null = null;
    private readonly _onEvent: (event: WsEvent) => void;

    public constructor() {
        this._onEvent = (event: WsEvent): void => this._push(event);
    }

    public async mount(container: JQuery): Promise<void> {
        this._container = container;
        container.html(Transcripts._template());
        WsClient.getInstance().on('transcript.partial', this._onEvent);
        WsClient.getInstance().on('transcript.final', this._onEvent);
    }

    public unmount(): void {
        WsClient.getInstance().off('transcript.partial', this._onEvent);
        WsClient.getInstance().off('transcript.final', this._onEvent);
    }

    private _push(event: WsEvent): void {
        if (event.type !== 'transcript.partial' && event.type !== 'transcript.final') {
            return;
        }
        const feed: JQuery | undefined = this._container?.find('#am-transcript-feed');
        if (feed === undefined) {
            return;
        }
        const who: string = event.line.speakerName ?? event.line.speakerId;
        const cls: string = event.line.final ? 'am-final' : 'am-partial';
        feed.append(
            `<div class="${cls}"><small class="text-muted">${esc(event.sessionId.slice(0, 8))}</small> <strong>${esc(who)}:</strong> ${esc(event.line.text)}</div>`,
        );
        feed.scrollTop(feed.prop('scrollHeight') as number);
    }

    private static _template(): string {
        return `
        <section class="content"><div class="container-fluid">
            <div class="card"><div class="card-header"><h3 class="card-title">Live Transcripts (all sessions)</h3></div>
                <div class="card-body am-transcript" id="am-transcript-feed"><span class="text-muted">Waiting for transcript events…</span></div>
            </div>
        </div></section>`;
    }

}
