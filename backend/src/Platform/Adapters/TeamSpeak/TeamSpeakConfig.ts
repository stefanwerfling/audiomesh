import type { AdapterConfig } from '../../IVoicePlatformAdapter.js';

/** TeamSpeak 3 voice server default UDP port. */
const DEFAULT_VOICE_PORT: number = 9987;

/**
 * Resolved, validated configuration for a TeamSpeak 3 platform. Built from the
 * opaque {@link AdapterConfig} the frontend stores per platform. Only `host` is
 * mandatory; everything else derives a sensible default so a stock TS3 server
 * works with just a host and a channel picked at join time.
 *
 * Unlike Jitsi (WebRTC) or Discord (`@discordjs/voice`), TS3 has no ready-made
 * Node voice client — we speak the raw TS3 UDP voice protocol ourselves (see
 * {@link Ts3ProtocolClient}). The bot therefore needs a persistent **identity**
 * (a TeamSpeak ECC keypair); when none is supplied one is generated and should be
 * persisted by the caller so the bot keeps a stable unique id across restarts.
 */
export interface TeamSpeakConfig {
    /** Server host or IP (no scheme, no port), e.g. `ts.example.com`. */
    host: string;
    /** Voice (UDP) port — defaults to 9987. */
    port: number;
    /** Nickname the bot shows in the server. */
    nickname: string;
    /** Optional server password (password-protected servers). */
    serverPassword: string | undefined;
    /**
     * Optional default channel to join right after connect. TS3 servers expose a
     * real channel directory, so this is a channel **id**; when unset the bot
     * lands in the server's default channel and a channel is chosen at join time.
     */
    defaultChannelId: string | undefined;
    /** Optional password for the joined channel. */
    channelPassword: string | undefined;
    /**
     * Base64-encoded TeamSpeak identity (ECC private key). When empty the client
     * generates a fresh identity on connect; persist it to keep a stable id.
     */
    identity: string | undefined;
    /** Join muted (a transcription/routing bot usually has nothing to say). */
    startMuted: boolean;
}

function asString(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function asBool(value: unknown, fallback: boolean): boolean {
    if (typeof value === 'boolean') {
        return value;
    }
    if (typeof value === 'string') {
        return value === 'true' || value === '1';
    }
    return fallback;
}

/**
 * Reduce a host-ish config value to just its `host` (and split off a `:port` when
 * present). Tolerates a pasted `ts3server://host?port=9987`-style URL or a bare
 * `host:port`, dropping any scheme/path so only the host remains.
 */
function splitHostPort(value: string): { host: string; port: number | undefined } {
    let stripped: string = value.replace(/^[a-z0-9]+:\/\//i, '');
    stripped = stripped.split('/')[0] ?? stripped;
    stripped = stripped.split('?')[0] ?? stripped;
    const parts: string[] = stripped.split(':');
    const host: string = parts[0] ?? stripped;
    const portRaw: string | undefined = parts[1];
    const port: number | undefined =
        portRaw !== undefined && /^\d+$/.test(portRaw) ? Number.parseInt(portRaw, 10) : undefined;
    return { host: host, port: port };
}

/**
 * Parse and validate a stored TeamSpeak {@link AdapterConfig}. Throws when `host`
 * is missing so the failure surfaces at connect time as a clean adapter error
 * rather than a later `undefined` deref. A `port` given inline in the host string
 * (`host:port`) wins over an explicit `port` field only when the latter is unset.
 */
export function parseTeamSpeakConfig(config: AdapterConfig): TeamSpeakConfig {
    const hostRaw: string | undefined = asString(config['host']);
    if (hostRaw === undefined) {
        throw new Error("TeamSpeakConfig: 'host' is required (e.g. ts.example.com)");
    }
    const { host, port: inlinePort } = splitHostPort(hostRaw);

    const explicitPort: number | undefined =
        typeof config['port'] === 'number'
            ? (config['port'] as number)
            : asString(config['port']) !== undefined
              ? Number.parseInt(asString(config['port']) as string, 10)
              : undefined;
    const port: number = explicitPort ?? inlinePort ?? DEFAULT_VOICE_PORT;

    return {
        host: host,
        port: Number.isFinite(port) && port > 0 ? port : DEFAULT_VOICE_PORT,
        nickname: asString(config['nickname']) ?? 'AudioMesh',
        serverPassword: asString(config['serverPassword']),
        defaultChannelId: asString(config['defaultChannelId']),
        channelPassword: asString(config['channelPassword']),
        identity: asString(config['identity']),
        startMuted: asBool(config['startMuted'], true),
    };
}
