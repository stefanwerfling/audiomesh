/*
 * The browser-environment shim that lets the vendored (official) lib-jitsi-meet
 * bundle run headless under Node. This — plus `../../../../vendor/jitsi/` — is
 * "our own Jitsi lib": we own this thin loader and pin which upstream build we
 * ship, but the library itself stays Jitsi's. `any` is unavoidable: the bundle is
 * an untyped browser UMD.
 *
 * Verified working against a real deployment (guest/anonymous over BOSH) on
 * 2026-08-20. The three runtime deps (`jsdom`, `@roamhq/wrtc`, `ws`) are imported
 * lazily so a deploy that never uses Jitsi needn't load native code.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const VENDOR_BUNDLE = new URL('../../../../vendor/jitsi/lib-jitsi-meet.min.js', import.meta.url);

/**
 * The loaded runtime: the `JitsiMeetJS` object plus the `wrtc` handle (the adapter
 * needs `wrtc.nonstandard.RTCAudioSink/Source` for the audio path).
 */
export interface JitsiRuntime {
    JitsiMeetJS: any;
    wrtc: any;
}

let _cached: JitsiRuntime | null = null;
let _globalsReady = false;

/**
 * Load lib-jitsi-meet headless. Idempotent (cached). `domain` seeds the emulated
 * page origin. Throws a clear, actionable error if the vendored bundle or the
 * runtime deps are missing.
 */
export async function loadJitsiRuntime(domain: string): Promise<JitsiRuntime> {
    if (_cached !== null) {
        return _cached;
    }
    const wrtc: any = await _import('@roamhq/wrtc');
    await _installBrowserGlobals(domain, wrtc);

    let JitsiMeetJS: any;
    try {
        const require = createRequire(import.meta.url);
        JitsiMeetJS = require(fileURLToPath(VENDOR_BUNDLE));
    } catch (error: unknown) {
        throw new Error(
            'JitsiRuntime: the vendored lib-jitsi-meet bundle failed to load. ' +
                'Fetch it with `npm run update:jitsi-lib -w @audiomesh/backend -- https://<your-jitsi>`. ' +
                `Original error: ${(error as Error).message}`,
        );
    }
    _cached = { JitsiMeetJS: JitsiMeetJS, wrtc: wrtc };
    return _cached;
}

async function _import(name: string): Promise<any> {
    try {
        const mod: any = await import(name);
        return mod.default ?? mod;
    } catch (error: unknown) {
        throw new Error(
            `JitsiRuntime: optional dependency '${name}' is not installed. ` +
                'Run: npm i -w @audiomesh/backend jsdom @roamhq/wrtc ws. ' +
                `Original error: ${(error as Error).message}`,
        );
    }
}

/**
 * Populate the globals the bundle reads at load/runtime, backed by jsdom (DOM),
 * `@roamhq/wrtc` (WebRTC) and `ws` (WebSocket). Two Node quirks are handled: the
 * bundle's UMD reads `self`, and Node ≥ 21 ships a read-only global `navigator`
 * that a plain assignment silently ignores — so we `defineProperty` it. Runs once.
 */
async function _installBrowserGlobals(domain: string, wrtc: any): Promise<void> {
    if (_globalsReady) {
        return;
    }
    const { JSDOM }: any = await _import('jsdom');
    const WebSocket: any = await _import('ws');
    const dom: any = new JSDOM('<!doctype html><html><body></body></html>', {
        url: `https://${domain}`,
        pretendToBeVisual: true,
    });
    const win: any = dom.window;
    const g: any = globalThis as any;

    g.self = g;
    g.window = win;
    g.document = win.document;
    g.location = win.location;
    g.WebSocket = WebSocket;
    win.WebSocket = WebSocket;

    // Node's built-in `navigator`/`window`/`document` (Node ≥ 21) are read-only;
    // define them so the bundle sees jsdom's, not Node's device-less navigator.
    for (const [key, value] of [
        ['navigator', win.navigator],
        ['window', win],
        ['document', win.document],
    ] as const) {
        try {
            Object.defineProperty(globalThis, key, {
                value: value,
                configurable: true,
                writable: true,
            });
        } catch {
            /* best effort */
        }
    }

    // Headless bot: no real media devices, but init() calls enumerateDevices().
    Object.defineProperty(win.navigator, 'mediaDevices', {
        configurable: true,
        value: {
            enumerateDevices: async (): Promise<unknown[]> => [],
            getUserMedia: async (): Promise<never> => {
                throw new Error('no media devices in a headless Jitsi bot');
            },
            addEventListener: (): void => {},
            removeEventListener: (): void => {},
        },
    });

    // The full WebRTC surface the bundle probes on window/global. RTCRtpTransceiver
    // in particular is mandatory: the lib's codec-preference feature-detect does
    // `'setCodecPreferences' in window.RTCRtpTransceiver.prototype`, which *throws*
    // (not returns false) if RTCRtpTransceiver is missing — aborting PeerConnection
    // setup right after CONFERENCE_JOINED. wrtc provides all of these.
    for (const key of [
        'RTCPeerConnection',
        'RTCSessionDescription',
        'RTCIceCandidate',
        'RTCRtpTransceiver',
        'RTCRtpSender',
        'RTCRtpReceiver',
        'RTCDataChannel',
        'RTCDataChannelEvent',
        'RTCDtlsTransport',
        'RTCIceTransport',
        'RTCSctpTransport',
        'RTCPeerConnectionIceEvent',
        'RTCPeerConnectionIceErrorEvent',
        'MediaStream',
        'MediaStreamTrack',
    ]) {
        if (wrtc[key] !== undefined) {
            g[key] = wrtc[key];
            win[key] = wrtc[key];
        }
    }

    // The bundled webrtc-adapter tries to re-wrap every `icecandidate` event's
    // `candidate` via Object.defineProperty and throws on wrtc's non-configurable
    // property ("Cannot redefine property: candidate") the moment ICE gathering
    // starts. adapter skips that shim when `RTCIceCandidate.prototype` already has
    // `foundation` — wrtc exposes `foundation` only per-instance, so advertise it
    // on the prototype to opt out of the shim.
    if (wrtc.RTCIceCandidate !== undefined && !('foundation' in wrtc.RTCIceCandidate.prototype)) {
        Object.defineProperty(wrtc.RTCIceCandidate.prototype, 'foundation', {
            value: null,
            configurable: true,
        });
    }
    // DOM globals the bundle reads off the global scope (provided by jsdom).
    for (const key of [
        'DOMParser',
        'XMLHttpRequest',
        'Event',
        'CustomEvent',
        'EventTarget',
        'Node',
        'Element',
        'HTMLElement',
        'DocumentFragment',
        'MutationObserver',
        'getComputedStyle',
        'localStorage',
        'sessionStorage',
        'btoa',
        'atob',
        'Blob',
        'FileReader',
        'performance',
    ]) {
        if (win[key] !== undefined && g[key] === undefined) {
            g[key] = win[key];
        }
    }
    _globalsReady = true;
}
