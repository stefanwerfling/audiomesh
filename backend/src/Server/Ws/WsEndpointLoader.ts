import { WebSocketEndpointLoader, type WebSocketEndpoint } from 'figtree';
import { EventsWebSocketEndpoint } from './EventsWebSocketEndpoint.js';

/**
 * Tells figtree's `HttpService` which WebSocket endpoints to mount. One for now —
 * the live event stream at `/api/ws`.
 */
export class WsEndpointLoader extends WebSocketEndpointLoader {

    public static override async loadEndpoints(): Promise<WebSocketEndpoint[]> {
        return [new EventsWebSocketEndpoint()];
    }

}
