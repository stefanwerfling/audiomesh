import type { Settings as SettingsDto } from '@audiomesh/schemas';
import { Api } from '../Net/Api.js';
import { esc } from '../Util/Html.js';
import type { IPage } from './IPage.js';

/**
 * Settings page — everything except the database is configured here. The OpenAI
 * API key is write-only: the field shows a "Configured / Not configured" hint,
 * never the key. Model / Transcription / TTS are selects populated from the
 * gateway's `/v1/models` via "Load models". Privacy switches default OFF.
 */
export class Settings implements IPage {
    private _container: JQuery | null = null;
    /** Model ids last fetched from the gateway (empty until "Load models"). */
    private _models: string[] = [];

    public async mount(container: JQuery): Promise<void> {
        this._container = container;
        container.html(Settings._template());
        container.find('#am-save-btn').on('click', async (): Promise<void> => this._save());
        container.find('#am-test-btn').on('click', async (): Promise<void> => this._test());
        container.find('#am-models-btn').on('click', async (): Promise<void> => this._loadModels());
        await this._load();
    }

    public unmount(): void {
        // no timers/subscriptions
    }

    private async _load(): Promise<void> {
        const c: JQuery | null = this._container;
        if (c === null) {
            return;
        }
        const settings: SettingsDto = await Api.settings();
        c.find('#am-base-url').val(settings.openai.baseUrl);
        this._fillSelect('#am-model', settings.openai.model);
        this._fillSelect('#am-transcription-model', settings.openai.transcriptionModel);
        this._fillSelect('#am-tts-model', settings.openai.ttsModel);
        c.find('#am-transcription-mode').val(settings.openai.transcriptionMode);
        c.find('#am-voice').val(settings.openai.voice);
        c.find('#am-key-status')
            .text(settings.openai.apiKeyConfigured ? 'Configured' : 'Not configured')
            .removeClass('badge-success badge-secondary')
            .addClass(settings.openai.apiKeyConfigured ? 'badge-success' : 'badge-secondary');
        c.find('#am-rec').prop('checked', settings.privacy.recordingEnabled);
        c.find('#am-store').prop('checked', settings.privacy.transcriptStorageEnabled);
        c.find('#am-retention').val(settings.privacy.retentionDays);
    }

    /**
     * Fill a model `<select>` with the loaded models, keeping `current` selected —
     * even when it isn't in the list yet (e.g. before "Load models", or a model the
     * gateway no longer advertises), so a saved value is never silently dropped.
     */
    private _fillSelect(selector: string, current: string): void {
        const sel: JQuery | undefined = this._container?.find(selector);
        if (sel === undefined) {
            return;
        }
        const options: string[] = this._models.slice();
        if (current.length > 0 && !options.includes(current)) {
            options.unshift(current);
        }
        sel.html(
            options
                .map((m: string): string => `<option value="${esc(m)}">${esc(m)}</option>`)
                .join(''),
        );
        sel.val(current);
    }

    private async _loadModels(): Promise<void> {
        const c: JQuery | null = this._container;
        if (c === null) {
            return;
        }
        const hint: JQuery = c.find('#am-models-hint');
        hint.text('loading…').removeClass('text-success text-danger');
        try {
            const baseUrl: string = String(c.find('#am-base-url').val() ?? '');
            const apiKey: string = String(c.find('#am-key').val() ?? '');
            const result = await Api.openaiModels(baseUrl, apiKey);
            if (!result.ok) {
                hint.text(result.message).addClass('text-danger');
                return;
            }
            this._models = result.models;
            // Repopulate each select, preserving the currently selected value.
            this._fillSelect('#am-model', String(c.find('#am-model').val() ?? ''));
            this._fillSelect(
                '#am-transcription-model',
                String(c.find('#am-transcription-model').val() ?? ''),
            );
            this._fillSelect('#am-tts-model', String(c.find('#am-tts-model').val() ?? ''));
            hint.text(`${result.models.length} models`).addClass('text-success');
        } catch (err) {
            hint.text((err as Error).message).addClass('text-danger');
        }
    }

    private async _save(): Promise<void> {
        const c: JQuery | null = this._container;
        if (c === null) {
            return;
        }
        const key: string = String(c.find('#am-key').val() ?? '');
        await Api.settingsSave({
            openai: {
                // Empty key = leave the stored one untouched (write-only field).
                ...(key.length > 0 ? { apiKey: key } : {}),
                baseUrl: String(c.find('#am-base-url').val() ?? ''),
                model: String(c.find('#am-model').val() ?? ''),
                transcriptionModel: String(c.find('#am-transcription-model').val() ?? ''),
                transcriptionMode:
                    c.find('#am-transcription-mode').val() === 'batch' ? 'batch' : 'realtime',
                ttsModel: String(c.find('#am-tts-model').val() ?? ''),
                voice: String(c.find('#am-voice').val() ?? ''),
            },
            privacy: {
                recordingEnabled: c.find('#am-rec').is(':checked'),
                transcriptStorageEnabled: c.find('#am-store').is(':checked'),
                retentionDays: Number(c.find('#am-retention').val() ?? 30),
            },
        });
        c.find('#am-key').val('');
        c.find('#am-save-hint').text('Saved.');
        await this._load();
    }

    private async _test(): Promise<void> {
        const hint: JQuery | undefined = this._container?.find('#am-test-hint');
        hint?.text('testing…');
        try {
            const result = await Api.openaiTest();
            hint?.text(result.message)
                .removeClass('text-success text-danger')
                .addClass(result.ok ? 'text-success' : 'text-danger');
        } catch (err) {
            hint?.text((err as Error).message).addClass('text-danger');
        }
    }

    private static _template(): string {
        return `
        <section class="content"><div class="container-fluid">
            <div class="card"><div class="card-header"><h3 class="card-title">OpenAI</h3></div>
                <div class="card-body">
                    <div class="form-group"><label>API Key <span id="am-key-status" class="badge badge-secondary">…</span></label>
                        <input id="am-key" type="password" class="form-control" placeholder="sk-… (write-only — never shown)" /></div>
                    <div class="form-group"><label>API Base URL</label>
                        <input id="am-base-url" class="form-control" placeholder="https://api.openai.com (or an OpenAI-compatible gateway)" /></div>
                    <div class="form-group">
                        <button id="am-models-btn" class="btn btn-outline-secondary btn-sm">Load models</button>
                        <small id="am-models-hint" class="text-muted ml-2">enter base URL + key, then load to populate the selects</small>
                    </div>
                    <div class="form-row">
                        <div class="col-md-3 form-group"><label>Model</label><select id="am-model" class="form-control"></select></div>
                        <div class="col-md-3 form-group"><label>Transcription</label><select id="am-transcription-model" class="form-control"></select></div>
                        <div class="col-md-3 form-group"><label>STT mode</label>
                            <select id="am-transcription-mode" class="form-control">
                                <option value="realtime">realtime (streaming WS)</option>
                                <option value="batch">batch (pause-segmented Whisper)</option>
                            </select></div>
                        <div class="col-md-3 form-group"><label>Voice</label><input id="am-voice" class="form-control" /></div>
                    </div>
                    <div class="form-row">
                        <div class="col-md-3 form-group"><label>TTS</label><select id="am-tts-model" class="form-control"></select></div>
                    </div>
                    <button id="am-test-btn" class="btn btn-info btn-sm">Test connection</button>
                    <small id="am-test-hint" class="text-muted ml-2">${esc('')}</small>
                </div>
            </div>
            <div class="card"><div class="card-header"><h3 class="card-title">Privacy</h3></div>
                <div class="card-body">
                    <div class="form-check"><input id="am-rec" type="checkbox" class="form-check-input" /><label class="form-check-label">Recording enabled</label></div>
                    <div class="form-check"><input id="am-store" type="checkbox" class="form-check-input" /><label class="form-check-label">Transcript storage enabled</label></div>
                    <div class="form-group mt-2" style="max-width:200px"><label>Retention (days)</label><input id="am-retention" type="number" class="form-control" /></div>
                </div>
            </div>
            <button id="am-save-btn" class="btn btn-primary">Save settings</button>
            <small id="am-save-hint" class="text-success ml-2"></small>
        </div></section>`;
    }
}
