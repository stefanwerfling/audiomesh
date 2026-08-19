import {
    WebSocketEndpoint,
    type WebSocketContext,
    type WebSocketEndpointOptions,
} from 'figtree';
import { WsHub } from './WsHub.js';

/**
 * The single `/api/ws` endpoint the frontend subscribes to for live events. It
 * is broadcast-only: the server pushes `WsEvent`s, the client never needs to send
 * anything (incoming messages are ignored). Connection bookkeeping is delegated
 * to {@link WsHub}, which the `WsEventBridge` fans out to.
 */
export class EventsWebSocketEndpoint extends WebSocketEndpoint {

    public getPath(): string {
        return '/api/ws';
    }

    public getOptions(): WebSocketEndpointOptions {
        return {
            description: 'AudioMesh live event stream (server → client broadcast).',
        };
    }

    public override async onConnect(ctx: WebSocketContext): Promise<void> {
        WsHub.getInstance().add(ctx.ws);
    }

    public override async onClose(ctx: WebSocketContext): Promise<void> {
        WsHub.getInstance().remove(ctx.ws);
    }

}
