import type {
    AgentProfile,
    AgentProfileBody,
    ApiResult,
    AudioRoute,
    AudioRouteBody,
    AuthState,
    Health,
    LoginBody,
    LoginResult,
    LogList,
    Metrics,
    Platform,
    PlatformBody,
    PlatformTestResult,
    Session,
    SessionStartBody,
    Settings,
    SettingsBody,
    OpenAiTestResult,
} from '@audiomesh/schemas';

/**
 * Typed fetch wrapper for the AudioMesh backend. Same-origin (the backend serves
 * this SPA), so responses aren't re-validated on the client — the backend already
 * validated them against the shared `@audiomesh/schemas` on the way out. The
 * bearer token, once obtained via {@link login}, is attached to every request.
 */
export class Api {

    public static readonly BASE: string = '/api/v1';

    private static _token: string | null = null;

    public static setToken(token: string | null): void {
        Api._token = token;
    }

    // --- auth ---------------------------------------------------------------

    public static async login(body: LoginBody): Promise<LoginResult> {
        return Api.json<LoginResult>('POST', `${Api.BASE}/auth/login`, body);
    }

    public static async me(): Promise<AuthState> {
        return Api.json<AuthState>('GET', `${Api.BASE}/auth/me`);
    }

    // --- system -------------------------------------------------------------

    public static async health(): Promise<Health> {
        return Api.json<Health>('GET', `${Api.BASE}/system/health`);
    }

    public static async metrics(): Promise<Metrics> {
        return Api.json<Metrics>('GET', `${Api.BASE}/system/metrics`);
    }

    public static async logs(): Promise<LogList> {
        return Api.json<LogList>('GET', `${Api.BASE}/system/logs`);
    }

    // --- sessions -----------------------------------------------------------

    public static async sessions(): Promise<Session[]> {
        return Api.json<Session[]>('GET', `${Api.BASE}/sessions/list`);
    }

    public static async session(id: string): Promise<Session | null> {
        return Api.json<Session | null>('GET', `${Api.BASE}/sessions/get?id=${encodeURIComponent(id)}`);
    }

    public static async sessionStart(body: SessionStartBody): Promise<Session> {
        return Api.json<Session>('POST', `${Api.BASE}/sessions/start`, body);
    }

    public static async sessionStop(sessionId: string): Promise<ApiResult> {
        return Api.json<ApiResult>('POST', `${Api.BASE}/sessions/stop`, { sessionId: sessionId });
    }

    // --- platforms ----------------------------------------------------------

    public static async platforms(): Promise<Platform[]> {
        return Api.json<Platform[]>('GET', `${Api.BASE}/platforms/list`);
    }

    public static async platformCreate(body: PlatformBody): Promise<Platform> {
        return Api.json<Platform>('POST', `${Api.BASE}/platforms/create`, body);
    }

    public static async platformUpdate(id: string, body: PlatformBody): Promise<Platform | null> {
        return Api.json<Platform | null>('POST', `${Api.BASE}/platforms/update?id=${encodeURIComponent(id)}`, body);
    }

    public static async platformDelete(id: string): Promise<ApiResult> {
        return Api.json<ApiResult>('POST', `${Api.BASE}/platforms/delete?id=${encodeURIComponent(id)}`);
    }

    public static async platformTest(id: string): Promise<PlatformTestResult> {
        return Api.json<PlatformTestResult>('POST', `${Api.BASE}/platforms/test?id=${encodeURIComponent(id)}`);
    }

    // --- routes -------------------------------------------------------------

    public static async routes(): Promise<AudioRoute[]> {
        return Api.json<AudioRoute[]>('GET', `${Api.BASE}/routes/list`);
    }

    public static async routeCreate(body: AudioRouteBody): Promise<AudioRoute> {
        return Api.json<AudioRoute>('POST', `${Api.BASE}/routes/create`, body);
    }

    public static async routeDelete(id: string): Promise<ApiResult> {
        return Api.json<ApiResult>('POST', `${Api.BASE}/routes/delete?id=${encodeURIComponent(id)}`);
    }

    public static async routeStart(id: string): Promise<ApiResult> {
        return Api.json<ApiResult>('POST', `${Api.BASE}/routes/start?id=${encodeURIComponent(id)}`);
    }

    public static async routeStop(id: string): Promise<ApiResult> {
        return Api.json<ApiResult>('POST', `${Api.BASE}/routes/stop?id=${encodeURIComponent(id)}`);
    }

    // --- agents -------------------------------------------------------------

    public static async agents(): Promise<AgentProfile[]> {
        return Api.json<AgentProfile[]>('GET', `${Api.BASE}/agents/list`);
    }

    public static async agentCreate(body: AgentProfileBody): Promise<AgentProfile> {
        return Api.json<AgentProfile>('POST', `${Api.BASE}/agents/create`, body);
    }

    public static async agentDelete(id: string): Promise<ApiResult> {
        return Api.json<ApiResult>('POST', `${Api.BASE}/agents/delete?id=${encodeURIComponent(id)}`);
    }

    // --- settings -----------------------------------------------------------

    public static async settings(): Promise<Settings> {
        return Api.json<Settings>('GET', `${Api.BASE}/settings/state`);
    }

    public static async settingsSave(body: SettingsBody): Promise<Settings> {
        return Api.json<Settings>('POST', `${Api.BASE}/settings/save`, body);
    }

    public static async openaiTest(): Promise<OpenAiTestResult> {
        return Api.json<OpenAiTestResult>('POST', `${Api.BASE}/settings/openai-test`);
    }

    // --- core ---------------------------------------------------------------

    private static async json<T>(method: string, url: string, body?: unknown): Promise<T> {
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (Api._token !== null) {
            headers['Authorization'] = `Bearer ${Api._token}`;
        }
        const init: RequestInit = {
            method: method,
            cache: 'no-cache',
            credentials: 'same-origin',
            headers: headers,
        };
        if (body !== undefined) {
            init.body = JSON.stringify(body);
        }
        const res: Response = await fetch(url, init);
        if (!res.ok && res.status !== 202) {
            throw new Error(`${method} ${url} failed: ${res.status} ${res.statusText}`);
        }
        return (await res.json()) as T;
    }

}
