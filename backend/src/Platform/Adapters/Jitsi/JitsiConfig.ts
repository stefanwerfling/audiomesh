import type { AdapterConfig } from '../../IVoicePlatformAdapter.js';

/**
 * Resolved, validated configuration for a Jitsi platform. Built from the opaque
 * {@link AdapterConfig} the frontend stores per platform. Only `domain` is
 * mandatory; everything else derives a sensible default from it so a stock
 * `meet.jit.si`-style server works with just the domain and a room name at join
 * time.
 */
export interface JitsiConfig {
    /** Jitsi domain, e.g. `meet.example.com` (no scheme). */
    domain: string;
    /** XMPP MUC host — defaults to `conference.<domain>`. */
    mucDomain: string;
    /**
     * Guest/anonymous XMPP host for secure-domain deployments — defaults to
     * `guest.<domain>`. Lets the bot join without a password (as a guest); the
     * room must already be open by an authenticated host.
     */
    anonymousDomain: string;
    /** BOSH endpoint used by lib-jitsi-meet to reach the XMPP server. */
    bosh: string;
    /** Optional native XMPP-over-WebSocket endpoint (preferred when set). */
    websocket: string | undefined;
    /** Display name the bot shows in the conference. */
    displayName: string;
    /** Optional authenticated login (secured deployments). */
    authUser: string | undefined;
    authPassword: string | undefined;
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
 * Reduce a host-ish config value to just its host. Tolerates a full pasted
 * meeting URL (`https://host/room`) — the scheme and any path (the room, which is
 * the session's channel, not platform config) are dropped, leaving `host[:port]`.
 */
function bareHost(value: string): string {
    const stripped: string = value.replace(/^[a-z]+:\/\//i, '');
    const host: string = stripped.split('/')[0] ?? stripped;
    return host.replace(/\/+$/, '');
}

/**
 * Parse and validate a stored Jitsi {@link AdapterConfig}. Throws when `domain`
 * is missing so the failure surfaces at connect time as a clean adapter error
 * rather than a later `undefined` deref.
 */
export function parseJitsiConfig(config: AdapterConfig): JitsiConfig {
    const domainRaw: string | undefined = asString(config['domain']);
    if (domainRaw === undefined) {
        throw new Error("JitsiConfig: 'domain' is required (e.g. meet.example.com)");
    }
    const domain: string = bareHost(domainRaw);
    const mucDomain: string = asString(config['mucDomain']) ?? `conference.${domain}`;
    const anonymousDomain: string = asString(config['anonymousDomain']) ?? `guest.${domain}`;
    const bosh: string = asString(config['bosh']) ?? `https://${domain}/http-bind`;

    return {
        domain: domain,
        mucDomain: mucDomain,
        anonymousDomain: anonymousDomain,
        bosh: bosh,
        websocket: asString(config['websocket']),
        displayName: asString(config['displayName']) ?? 'AudioMesh',
        authUser: asString(config['authUser']),
        authPassword: asString(config['authPassword']),
        startMuted: asBool(config['startMuted'], true),
    };
}
