import type { WsEvent, WsEventType } from '@audiomesh/schemas';

export type WsEventListener = (event: WsEvent) => void;

/**
 * Live event stream client. Connects to the backend `/api/ws` over the same
 * origin (wss when the page is https), auto-reconnects with capped backoff, and
 * fans events out to per-type + wildcard listeners. This is how the UI stays live
 * without polling. Singleton so every page shares one socket.
 */
export class WsClient {

    private static _instance: WsClient | null = null;

    public static getInstance(): WsClient {
        if (WsClient._instance === null) {
            WsClient._instance = new WsClient();
        }
        return WsClient._instance;
    }

    private _socket: WebSocket | null = null;
    private _backoffMs: number = 1000;
    private readonly _typed: Map<WsEventType, Set<WsEventListener>> = new Map();
    private readonly _all: Set<WsEventListener> = new Set();
    private _statusListeners: Set<(connected: boolean) => void> = new Set();

    public connect(): void {
        if (this._socket !== null) {
            return;
        }
        const proto: string = window.location.protocol === 'https:' ? 'wss' : 'ws';
        const url: string = `${proto}://${window.location.host}/api/ws`;
        const socket: WebSocket = new WebSocket(url);
        this._socket = socket;

        socket.onopen = (): void => {
            this._backoffMs = 1000;
            this._emitStatus(true);
        };
        socket.onmessage = (ev: MessageEvent): void => {
            try {
                const event: WsEvent = JSON.parse(ev.data as string) as WsEvent;
                this._dispatch(event);
            } catch {
                // ignore malformed frames
            }
        };
        socket.onclose = (): void => {
            this._socket = null;
            this._emitStatus(false);
            window.setTimeout((): void => this.connect(), this._backoffMs);
            this._backoffMs = Math.min(this._backoffMs * 2, 15000);
        };
        socket.onerror = (): void => {
            socket.close();
        };
    }

    public on(type: WsEventType, listener: WsEventListener): void {
        let set: Set<WsEventListener> | undefined = this._typed.get(type);
        if (set === undefined) {
            set = new Set();
            this._typed.set(type, set);
        }
        set.add(listener);
    }

    public off(type: WsEventType, listener: WsEventListener): void {
        this._typed.get(type)?.delete(listener);
    }

    public onAny(listener: WsEventListener): void {
        this._all.add(listener);
    }

    public offAny(listener: WsEventListener): void {
        this._all.delete(listener);
    }

    public onStatus(listener: (connected: boolean) => void): void {
        this._statusListeners.add(listener);
    }

    public offStatus(listener: (connected: boolean) => void): void {
        this._statusListeners.delete(listener);
    }

    private _dispatch(event: WsEvent): void {
        for (const listener of this._all) {
            listener(event);
        }
        for (const listener of this._typed.get(event.type) ?? []) {
            listener(event);
        }
    }

    private _emitStatus(connected: boolean): void {
        for (const listener of this._statusListeners) {
            listener(connected);
        }
    }

}
