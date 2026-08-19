import type { WsEvent } from '@audiomesh/schemas';
import { Logger } from 'figtree';
import type { WebSocket } from 'ws';

/**
 * Registry of live frontend WebSocket connections + a broadcast fan-out. The
 * figtree `WebSocketEndpoint` adds/removes sockets here on connect/close; the
 * `WsEventBridge` calls {@link broadcast} to push domain events to every client.
 * Kept separate from the endpoint so the event bridge doesn't depend on figtree's
 * connection lifecycle details.
 */
export class WsHub {

    private static _instance: WsHub | null = null;

    public static getInstance(): WsHub {
        if (WsHub._instance === null) {
            WsHub._instance = new WsHub();
        }
        return WsHub._instance;
    }

    private readonly _sockets: Set<WebSocket> = new Set();

    public add(socket: WebSocket): void {
        this._sockets.add(socket);
    }

    public remove(socket: WebSocket): void {
        this._sockets.delete(socket);
    }

    public count(): number {
        return this._sockets.size;
    }

    public broadcast(event: WsEvent): void {
        const payload: string = JSON.stringify(event);
        for (const socket of this._sockets) {
            // 1 === WebSocket.OPEN — avoid importing the enum for one constant.
            if (socket.readyState !== 1) {
                continue;
            }
            try {
                socket.send(payload);
            } catch (error: unknown) {
                Logger.getLogger().warn(`WsHub: send failed: ${(error as Error).message}`);
            }
        }
    }

}
