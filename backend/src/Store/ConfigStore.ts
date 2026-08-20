import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import type {
    AgentProfile,
    AgentProfileBody,
    AudioRoute,
    AudioRouteBody,
    Platform,
    PlatformBody,
    Settings,
    SettingsBody,
} from '@audiomesh/schemas';
import { Logger } from 'figtree';

interface StoredPlatform {
    id: string;
    kind: Platform['kind'];
    name: string;
    enabled: boolean;
    config: Record<string, unknown>;
}

interface StoredOpenAi {
    apiKey: string;
    model: string;
    transcriptionModel: string;
    ttsModel: string;
    voice: string;
    connected: boolean;
}

interface StoredState {
    platforms: StoredPlatform[];
    agents: AgentProfile[];
    routes: AudioRoute[];
    openai: StoredOpenAi;
    privacy: Settings['privacy'];
}

/**
 * Single JSON-file store for all user-editable configuration (platforms, agents,
 * routes, settings). Mirrors the house `SettingsStore` pattern (headbangbear's
 * `.hbb-settings.json`) — simple, no native dep, easy to back up. Domain data
 * that grows unbounded (sessions, transcripts) will move to TypeORM later; this
 * store stays for the small, hand-edited config set.
 *
 * **Secrets never leave the backend**: the OpenAI API key is held here but the
 * `Settings` DTO only ever exposes `apiKeyConfigured`. Same for platform config
 * secrets — `toPlatformDto` returns the config as-is for now, but the key path
 * (OpenAI) is fully redacted.
 */
export class ConfigStore {
    private static _instance: ConfigStore | null = null;

    public static install(filePath: string): ConfigStore {
        const inst: ConfigStore = new ConfigStore(filePath);
        inst.load();
        ConfigStore._instance = inst;
        return inst;
    }

    public static getInstance(): ConfigStore {
        if (ConfigStore._instance === null) {
            throw new Error('ConfigStore: not installed — call ConfigStore.install() first');
        }
        return ConfigStore._instance;
    }

    private readonly _filePath: string;
    private _state: StoredState;

    public constructor(filePath: string) {
        this._filePath = filePath;
        this._state = ConfigStore._defaults();
    }

    private static _defaults(): StoredState {
        return {
            platforms: [],
            agents: [],
            routes: [],
            openai: {
                apiKey: '',
                model: 'gpt-4o',
                transcriptionModel: 'gpt-4o-transcribe',
                ttsModel: 'gpt-4o-mini-tts',
                voice: 'alloy',
                connected: false,
            },
            privacy: {
                recordingEnabled: false,
                transcriptStorageEnabled: false,
                retentionDays: 30,
            },
        };
    }

    public load(): void {
        if (!existsSync(this._filePath)) {
            return;
        }
        try {
            const raw: string = readFileSync(this._filePath, 'utf-8');
            const parsed: Partial<StoredState> = JSON.parse(raw) as Partial<StoredState>;
            this._state = { ...ConfigStore._defaults(), ...parsed };
        } catch (error: unknown) {
            Logger.getLogger().error(
                `ConfigStore: failed to load, using defaults: ${(error as Error).message}`,
            );
            this._state = ConfigStore._defaults();
        }
    }

    private _persist(): void {
        const dir: string = dirname(this._filePath);
        if (!existsSync(dir)) {
            mkdirSync(dir, { recursive: true });
        }
        writeFileSync(this._filePath, JSON.stringify(this._state, null, 4), 'utf-8');
    }

    // --- Platforms ----------------------------------------------------------

    public listPlatforms(): Platform[] {
        return this._state.platforms.map((p: StoredPlatform): Platform => this._toPlatformDto(p));
    }

    public getStoredPlatform(id: string): StoredPlatform | null {
        return this._state.platforms.find((p: StoredPlatform): boolean => p.id === id) ?? null;
    }

    public createPlatform(body: PlatformBody): Platform {
        const platform: StoredPlatform = {
            id: randomUUID(),
            kind: body.kind,
            name: body.name,
            enabled: body.enabled,
            config: (body.config as Record<string, unknown> | undefined) ?? {},
        };
        this._state.platforms.push(platform);
        this._persist();
        return this._toPlatformDto(platform);
    }

    public updatePlatform(id: string, body: PlatformBody): Platform | null {
        const platform: StoredPlatform | null = this.getStoredPlatform(id);
        if (platform === null) {
            return null;
        }
        platform.kind = body.kind;
        platform.name = body.name;
        platform.enabled = body.enabled;
        platform.config = (body.config as Record<string, unknown> | undefined) ?? platform.config;
        this._persist();
        return this._toPlatformDto(platform);
    }

    public deletePlatform(id: string): boolean {
        const before: number = this._state.platforms.length;
        this._state.platforms = this._state.platforms.filter(
            (p: StoredPlatform): boolean => p.id !== id,
        );
        const changed: boolean = this._state.platforms.length !== before;
        if (changed) {
            this._persist();
        }
        return changed;
    }

    private _toPlatformDto(platform: StoredPlatform): Platform {
        return {
            id: platform.id,
            kind: platform.kind,
            name: platform.name,
            enabled: platform.enabled,
            connected: false,
            config: platform.config,
        };
    }

    // --- Agents -------------------------------------------------------------

    public listAgents(): AgentProfile[] {
        return this._state.agents;
    }

    public createAgent(body: AgentProfileBody): AgentProfile {
        const agent: AgentProfile = { id: randomUUID(), ...body };
        this._state.agents.push(agent);
        this._persist();
        return agent;
    }

    public updateAgent(id: string, body: AgentProfileBody): AgentProfile | null {
        const index: number = this._state.agents.findIndex(
            (a: AgentProfile): boolean => a.id === id,
        );
        if (index === -1) {
            return null;
        }
        const updated: AgentProfile = { id: id, ...body };
        this._state.agents[index] = updated;
        this._persist();
        return updated;
    }

    public deleteAgent(id: string): boolean {
        const before: number = this._state.agents.length;
        this._state.agents = this._state.agents.filter((a: AgentProfile): boolean => a.id !== id);
        const changed: boolean = this._state.agents.length !== before;
        if (changed) {
            this._persist();
        }
        return changed;
    }

    // --- Routes -------------------------------------------------------------

    public listRoutes(): AudioRoute[] {
        return this._state.routes;
    }

    public createRoute(body: AudioRouteBody): AudioRoute {
        const route: AudioRoute = { id: randomUUID(), state: 'stopped', ...body };
        this._state.routes.push(route);
        this._persist();
        return route;
    }

    public updateRoute(id: string, body: AudioRouteBody): AudioRoute | null {
        const index: number = this._state.routes.findIndex((r: AudioRoute): boolean => r.id === id);
        if (index === -1) {
            return null;
        }
        const existing: AudioRoute = this._state.routes[index] as AudioRoute;
        const updated: AudioRoute = { id: id, state: existing.state, ...body };
        this._state.routes[index] = updated;
        this._persist();
        return updated;
    }

    public deleteRoute(id: string): boolean {
        const before: number = this._state.routes.length;
        this._state.routes = this._state.routes.filter((r: AudioRoute): boolean => r.id !== id);
        const changed: boolean = this._state.routes.length !== before;
        if (changed) {
            this._persist();
        }
        return changed;
    }

    // --- Settings -----------------------------------------------------------

    public getSettings(): Settings {
        return {
            openai: {
                apiKeyConfigured: this._state.openai.apiKey.length > 0,
                connected: this._state.openai.connected,
                model: this._state.openai.model,
                transcriptionModel: this._state.openai.transcriptionModel,
                ttsModel: this._state.openai.ttsModel,
                voice: this._state.openai.voice,
            },
            privacy: this._state.privacy,
        };
    }

    /** Backend-only accessor for the raw OpenAI key. Never exposed via a route. */
    public getOpenAiKey(): string {
        return this._state.openai.apiKey;
    }

    /** Directory the store lives in — the base for sibling data like recordings. */
    public getBaseDir(): string {
        return dirname(this._filePath);
    }

    public saveSettings(body: SettingsBody): Settings {
        // Empty/omitted apiKey leaves the stored key untouched (the UI never
        // re-sends the secret it can't read back).
        if (body.openai.apiKey !== undefined && body.openai.apiKey.length > 0) {
            this._state.openai.apiKey = body.openai.apiKey;
        }
        this._state.openai.model = body.openai.model;
        this._state.openai.transcriptionModel = body.openai.transcriptionModel;
        this._state.openai.ttsModel = body.openai.ttsModel;
        this._state.openai.voice = body.openai.voice;
        this._state.privacy = body.privacy;
        this._persist();
        return this.getSettings();
    }

    public setOpenAiConnected(connected: boolean): void {
        this._state.openai.connected = connected;
        this._persist();
    }
}
