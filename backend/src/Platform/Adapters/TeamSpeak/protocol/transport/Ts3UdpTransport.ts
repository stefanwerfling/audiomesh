import dgram from 'node:dgram';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import type { Buffer } from 'node:buffer';

/**
 * TS3's hard UDP payload cap. Every datagram — header, MAC and data — must fit in
 * 500 bytes (see `../PROTOCOL.md` §1). The codec/reliability layers keep command
 * data under this by compressing and fragmenting; this transport only enforces it.
 */
export const MAX_UDP_PAYLOAD: number = 500;

/** Callbacks the transport raises once open. Set before {@link Ts3UdpTransport.open}. */
export interface Ts3UdpTransportHandlers {
    /** One inbound datagram (a whole packet; UDP preserves message boundaries). */
    onMessage(data: Buffer): void;
    /** Async socket error after open. */
    onError(error: Error): void;
    /** Socket closed (by us or the OS). */
    onClose(): void;
}

/**
 * Layer 1 of the native TS3 stack: a thin UDP socket wrapper with **no protocol
 * knowledge**. It resolves the server host (A/AAAA), opens a `dgram` socket of the
 * matching family, connects it to the remote so sends need no address and only the
 * server's datagrams are delivered, and enforces the 500-byte MTU on send. Packet
 * layout, crypto and reliability all live in the layers above.
 */
export class Ts3UdpTransport {
    private _socket: dgram.Socket | null = null;
    private _handlers: Ts3UdpTransportHandlers | null = null;

    public setHandlers(handlers: Ts3UdpTransportHandlers): void {
        this._handlers = handlers;
    }

    /**
     * Resolve `host`, open a connected UDP socket to `host:port`, and start
     * delivering datagrams to the handlers. Resolves once the socket is connected;
     * rejects if resolution or connect fails.
     */
    public async open(host: string, port: number): Promise<void> {
        if (this._socket !== null) {
            throw new Error('Ts3UdpTransport: already open');
        }
        const literal: number = isIP(host);
        let address: string = host;
        let socketType: dgram.SocketType = literal === 6 ? 'udp6' : 'udp4';
        if (literal === 0) {
            const resolved = await lookup(host);
            address = resolved.address;
            socketType = resolved.family === 6 ? 'udp6' : 'udp4';
        }

        const socket: dgram.Socket = dgram.createSocket(socketType);
        await new Promise<void>((resolve, reject): void => {
            const onError = (error: Error): void => {
                socket.close();
                reject(error);
            };
            socket.once('error', onError);
            socket.connect(port, address, (): void => {
                socket.off('error', onError);
                resolve();
            });
        });

        // Attach the durable listeners only after a clean connect, so a connect
        // failure surfaces once (as the open() rejection) and never as onError.
        socket.on('message', (data: Buffer): void => this._handlers?.onMessage(data));
        socket.on('error', (error: Error): void => this._handlers?.onError(error));
        socket.on('close', (): void => this._handlers?.onClose());
        this._socket = socket;
    }

    /** Send one datagram. Throws if not open or the payload exceeds the MTU. */
    public send(data: Buffer): void {
        if (this._socket === null) {
            throw new Error('Ts3UdpTransport: not open');
        }
        if (data.length > MAX_UDP_PAYLOAD) {
            throw new Error(
                `Ts3UdpTransport: datagram ${data.length} B exceeds ${MAX_UDP_PAYLOAD} B MTU`,
            );
        }
        this._socket.send(data);
    }

    public isOpen(): boolean {
        return this._socket !== null;
    }

    /** Close the socket; resolves once closed. Idempotent. */
    public async close(): Promise<void> {
        const socket: dgram.Socket | null = this._socket;
        this._socket = null;
        if (socket === null) {
            return;
        }
        await new Promise<void>((resolve): void => {
            socket.close((): void => resolve());
        });
    }
}
