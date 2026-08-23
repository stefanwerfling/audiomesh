import dgram from 'node:dgram';
import { Buffer } from 'node:buffer';
import { afterEach, describe, expect, it } from 'vitest';
import {
    MAX_UDP_PAYLOAD,
    Ts3UdpTransport,
} from '../../../../src/Platform/Adapters/TeamSpeak/protocol/transport/Ts3UdpTransport.js';

/** Bind a loopback UDP echo server; resolves with the server + its chosen port. */
async function startEchoServer(
    prefix: string,
): Promise<{ server: dgram.Socket; port: number; received: Buffer[] }> {
    const server: dgram.Socket = dgram.createSocket('udp4');
    const received: Buffer[] = [];
    server.on('message', (msg: Buffer, rinfo: dgram.RemoteInfo): void => {
        received.push(Buffer.from(msg));
        server.send(Buffer.concat([Buffer.from(prefix), msg]), rinfo.port, rinfo.address);
    });
    await new Promise<void>((resolve): void => {
        server.bind(0, '127.0.0.1', (): void => resolve());
    });
    const port: number = (server.address() as { port: number }).port;
    return { server: server, port: port, received: received };
}

describe('Ts3UdpTransport', () => {
    let transport: Ts3UdpTransport | null = null;
    let server: dgram.Socket | null = null;

    afterEach(async () => {
        if (transport !== null) {
            await transport.close();
            transport = null;
        }
        if (server !== null) {
            await new Promise<void>((resolve): void => server?.close((): void => resolve()));
            server = null;
        }
    });

    it('round-trips a datagram over loopback', async () => {
        const echo = await startEchoServer('echo:');
        server = echo.server;

        transport = new Ts3UdpTransport();
        const reply: Promise<Buffer> = new Promise<Buffer>((resolve): void => {
            transport?.setHandlers({
                onMessage: (data: Buffer): void => resolve(data),
                onError: (): void => {},
                onClose: (): void => {},
            });
        });

        await transport.open('127.0.0.1', echo.port);
        expect(transport.isOpen()).toBe(true);
        transport.send(Buffer.from('hello'));

        const got: Buffer = await reply;
        expect(echo.received[0]?.toString()).toBe('hello');
        expect(got.toString()).toBe('echo:hello');
    });

    it('accepts a datagram at exactly the MTU and rejects one over it', async () => {
        const echo = await startEchoServer('x');
        server = echo.server;
        transport = new Ts3UdpTransport();
        transport.setHandlers({
            onMessage: (): void => {},
            onError: (): void => {},
            onClose: (): void => {},
        });
        await transport.open('127.0.0.1', echo.port);

        expect(() => transport?.send(Buffer.alloc(MAX_UDP_PAYLOAD))).not.toThrow();
        expect(() => transport?.send(Buffer.alloc(MAX_UDP_PAYLOAD + 1))).toThrow(/MTU/);
    });

    it('throws when sending before open', () => {
        transport = new Ts3UdpTransport();
        expect(() => transport?.send(Buffer.from([0]))).toThrow(/not open/);
        expect(transport.isOpen()).toBe(false);
    });

    it('close is idempotent', async () => {
        transport = new Ts3UdpTransport();
        await transport.close();
        await transport.close();
        expect(transport.isOpen()).toBe(false);
    });
});
