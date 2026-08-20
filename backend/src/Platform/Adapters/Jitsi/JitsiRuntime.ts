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
 * The WebRTC classes we expose on window/global from wrtc so the bundle can find
 * them. RTCRtpTransceiver is mandatory (its prototype gates the lib's
 * codec-preference feature-detect). These are also the prototypes we snapshot and
 * restore around the bundle require — see {@link loadJitsiRuntime}.
 */
const WRTC_GLOBAL_CLASSES: readonly string[] = [
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
];

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

    // The bundle runs webrtc-adapter at require time, which patches the WebRTC
    // classes on window — i.e. wrtc's *shared* native prototypes — with DOM-style
    // shims (onicecandidate/addEventListener wrappers, SDP munging, candidate
    // re-wrapping). Those shims are incompatible with wrtc and abort its native ICE
    // gathering the moment a conference starts. wrtc's own prototypes are already
    // browser-compatible (Chromium/unified-plan), so we snapshot every class we
    // expose (prototype + constructor statics like RTCRtpSender.getCapabilities)
    // before the require and restore them after — undoing adapter's patching while
    // keeping the loaded JitsiMeetJS. Restoring only RTCPeerConnection is not
    // enough: adapter also corrupts RTCRtpSender/Receiver/transport prototypes.
    const snapshots: Array<{ target: any; snap: Map<string, PropertyDescriptor> }> = [];
    for (const key of WRTC_GLOBAL_CLASSES) {
        const ctor: any = wrtc[key];
        if (ctor === undefined) {
            continue;
        }
        snapshots.push({ target: ctor, snap: _snapshotOwnDescriptors(ctor) });
        if (ctor.prototype !== undefined && ctor.prototype !== null) {
            snapshots.push({ target: ctor.prototype, snap: _snapshotOwnDescriptors(ctor.prototype) });
        }
    }

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

    for (const { target, snap } of snapshots) {
        _restoreOwnDescriptors(target, snap);
    }
    _cached = { JitsiMeetJS: JitsiMeetJS, wrtc: wrtc };
    return _cached;
}

/** Capture every own-property descriptor of an object (for later exact restore). */
function _snapshotOwnDescriptors(obj: any): Map<string, PropertyDescriptor> {
    const snap: Map<string, PropertyDescriptor> = new Map();
    for (const key of Object.getOwnPropertyNames(obj)) {
        const desc: PropertyDescriptor | undefined = Object.getOwnPropertyDescriptor(obj, key);
        if (desc !== undefined) {
            snap.set(key, desc);
        }
    }
    return snap;
}

/** Restore an object to a prior snapshot: drop keys added since, reinstate originals. */
function _restoreOwnDescriptors(obj: any, snapshot: Map<string, PropertyDescriptor>): void {
    for (const key of Object.getOwnPropertyNames(obj)) {
        if (!snapshot.has(key)) {
            try {
                delete obj[key];
            } catch {
                /* non-configurable: leave it */
            }
        }
    }
    for (const [key, desc] of snapshot) {
        try {
            Object.defineProperty(obj, key, desc);
        } catch {
            /* non-configurable / unchanged: skip */
        }
    }
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

    // Present as Chrome — this MUST happen before the lib bundle is required.
    // lib-jitsi-meet bundles webrtc-adapter, which sniffs the user-agent at load
    // time and applies engine-specific shims to window.RTCPeerConnection — and
    // because that is wrtc's *shared* prototype, the wrong shim set corrupts every
    // PeerConnection. jsdom's default UA ("…AppleWebKit… jsdom…") is detected as
    // Safari, whose shims abort wrtc's native ICE gathering right after
    // CONFERENCE_JOINED. wrtc *is* libwebrtc (Chromium), so a Chrome UA selects the
    // shim set compatible with it. (jsdom's `userAgent` constructor option is a
    // no-op in jsdom 30, so override navigator.userAgent directly.)
    Object.defineProperty(win.navigator, 'userAgent', {
        configurable: true,
        value: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    });

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
    for (const key of WRTC_GLOBAL_CLASSES) {
        if (wrtc[key] !== undefined) {
            g[key] = wrtc[key];
            win[key] = wrtc[key];
        }
    }

    // (Note: we deliberately do NOT force webrtc-adapter to skip its
    // shimRTCIceCandidate. Making it skip — e.g. by advertising `foundation` on
    // RTCIceCandidate.prototype — leaves wrtc's native candidate handling in the
    // gathering path, which SIGABRTs the process. Letting the shim run is benign
    // once the prototype restore below removes adapter's harmful onicecandidate
    // re-wrapper from RTCPeerConnection.prototype.)

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
