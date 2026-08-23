import { Buffer } from 'node:buffer';
import { randomBytes } from 'node:crypto';
import { PacketFlags, PacketType } from '../packet/PacketType.js';
import {
    decodePacket,
    encodePacket,
    PacketDirection,
    type Ts3Packet,
} from '../packet/Ts3Packet.js';
import { solveRsaPuzzle } from './RsaPuzzle.js';

/**
 * The low-level Init1 handshake (`../PROTOCOL.md` §3) — the unencrypted packet
 * 0..4 exchange that precedes the crypto handshake. All Init1 packets use the
 * fixed MAC `"TS3INIT1"`, packet id 101, client id 0, type Init1 with the
 * Unencrypted flag. The client proves work on the server's RSA puzzle
 * ({@link solveRsaPuzzle}) and rides the first `clientinitiv` command out on
 * packet 4.
 *
 * NOTE: the exact byte layout follows the spec capture in `../PROTOCOL.md` §3 and
 * must be confirmed against a live server / TSLib capture before trusting a real
 * connect (see PROTOCOL.md §10). The RSA solver and the state transitions are
 * independently unit-tested.
 */

/** Fixed 8-byte MAC on every Init1 packet. */
export const INIT1_MAC: Buffer = Buffer.from('TS3INIT1', 'latin1');
/** Fixed packet id used for all Init1 packets. */
export const INIT1_PACKET_ID: number = 101;
/** TS3 version epoch: client version = unixSeconds − this, as u32 BE. */
export const TS3_VERSION_EPOCH: number = 1_356_998_400;

const STEP_C_BEGIN: number = 0x00;
const STEP_S_COOKIE: number = 0x01;
const STEP_C_COOKIE_ECHO: number = 0x02;
const STEP_S_PUZZLE: number = 0x03;
const STEP_C_SOLVE: number = 0x04;
/** Server tells the client to restart the connection. */
export const STEP_RESTART: number = 0x7f;

/** Encode a client version field: `unixSeconds − TS3_VERSION_EPOCH` as u32 BE (4 B). */
export function encodeClientVersion(unixSeconds: number): Buffer {
    const buffer: Buffer = Buffer.alloc(4);
    buffer.writeUInt32BE((unixSeconds - TS3_VERSION_EPOCH) >>> 0, 0);
    return buffer;
}

/** Wrap an Init1 data payload into a full client→server packet. */
export function wrapClientInit1(data: Buffer): Buffer {
    return encodePacket(PacketDirection.ClientToServer, init1Packet(0, data));
}

/** Wrap an Init1 data payload into a full server→client packet (for tests/tools). */
export function wrapServerInit1(data: Buffer): Buffer {
    return encodePacket(PacketDirection.ServerToClient, init1Packet(0, data));
}

/** Parse a raw Init1 packet in the given direction, returning its data payload. */
export function unwrapInit1(direction: PacketDirection, raw: Buffer): Buffer {
    const packet: Ts3Packet = decodePacket(direction, raw);
    if (!packet.mac.equals(INIT1_MAC)) {
        throw new Error('Init1: wrong MAC (not TS3INIT1)');
    }
    if (packet.type !== PacketType.Init1) {
        throw new Error(`Init1: wrong packet type ${packet.type}`);
    }
    return packet.data;
}

function init1Packet(clientId: number, data: Buffer): Ts3Packet {
    return {
        mac: INIT1_MAC,
        packetId: INIT1_PACKET_ID,
        clientId: clientId,
        type: PacketType.Init1,
        flags: PacketFlags.Unencrypted,
        data: data,
    };
}

// --- payload builders (one per step) ---------------------------------------

/** packet 0: version(4) + 0x00 + timestamp(4) + randomA0(4) + zeros(8). */
export function buildPacket0(version: Buffer, timestampSeconds: number, randomA0: Buffer): Buffer {
    const data: Buffer = Buffer.alloc(21);
    version.copy(data, 0, 0, 4);
    data[4] = STEP_C_BEGIN;
    data.writeUInt32BE(timestampSeconds >>> 0, 5);
    randomA0.copy(data, 9, 0, 4);
    return data;
}

/** packet 1 (server): 0x01 + A1(16) + A0-reversed(4). */
export function buildPacket1(a1: Buffer, a0Reversed: Buffer): Buffer {
    const data: Buffer = Buffer.alloc(21);
    data[0] = STEP_S_COOKIE;
    a1.copy(data, 1, 0, 16);
    a0Reversed.copy(data, 17, 0, 4);
    return data;
}

/** packet 2: version(4) + 0x02 + A1(16) + A0-reversed(4). */
export function buildPacket2(version: Buffer, a1: Buffer, a0Reversed: Buffer): Buffer {
    const data: Buffer = Buffer.alloc(25);
    version.copy(data, 0, 0, 4);
    data[4] = STEP_C_COOKIE_ECHO;
    a1.copy(data, 5, 0, 16);
    a0Reversed.copy(data, 21, 0, 4);
    return data;
}

/** packet 3 (server): 0x03 + x(64) + n(64) + level(4) + A2(100). */
export function buildPacket3(x: Buffer, n: Buffer, level: number, a2: Buffer): Buffer {
    const data: Buffer = Buffer.alloc(233);
    data[0] = STEP_S_PUZZLE;
    x.copy(data, 1, 0, 64);
    n.copy(data, 65, 0, 64);
    data.writeUInt32BE(level >>> 0, 129);
    a2.copy(data, 133, 0, 100);
    return data;
}

/** packet 4: version(4) + 0x04 + x(64) + n(64) + level(4) + A2(100) + y(64) + clientinitiv. */
export function buildPacket4(
    version: Buffer,
    x: Buffer,
    n: Buffer,
    level: number,
    a2: Buffer,
    y: Buffer,
    clientInitIv: Buffer,
): Buffer {
    const head: Buffer = Buffer.alloc(233);
    version.copy(head, 0, 0, 4);
    head[4] = STEP_C_SOLVE;
    x.copy(head, 5, 0, 64);
    n.copy(head, 69, 0, 64);
    head.writeUInt32BE(level >>> 0, 133);
    a2.copy(head, 137, 0, 100);
    return Buffer.concat([head, y, clientInitIv]);
}

/** Parsed server puzzle (packet 3). */
export interface Init1Puzzle {
    x: Buffer;
    n: Buffer;
    level: number;
    a2: Buffer;
}

/** Parse server packet 1 → {a1, a0Reversed}. Throws on an unexpected step byte. */
export function parsePacket1(data: Buffer): { a1: Buffer; a0Reversed: Buffer } {
    if (data.length < 21 || data[0] !== STEP_S_COOKIE) {
        throw new Error('Init1: malformed packet 1');
    }
    return { a1: data.subarray(1, 17), a0Reversed: data.subarray(17, 21) };
}

/** Parse server packet 3 → puzzle. Throws on an unexpected step byte. */
export function parsePacket3(data: Buffer): Init1Puzzle {
    if (data.length < 233 || data[0] !== STEP_S_PUZZLE) {
        throw new Error('Init1: malformed packet 3');
    }
    return {
        x: data.subarray(1, 65),
        n: data.subarray(65, 129),
        level: data.readUInt32BE(129),
        a2: data.subarray(133, 233),
    };
}

// --- state machine ----------------------------------------------------------

/** What the caller should do next after feeding a server Init1 packet. */
export type Init1Outcome =
    | { kind: 'send'; packet: Buffer }
    | { kind: 'complete'; packet: Buffer }
    | { kind: 'restart' }
    | { kind: 'error'; message: string };

/**
 * Drives the Init1 exchange. The caller pumps the transport: {@link start} → send
 * packet 0; on each server Init1 packet call {@link onServerPacket} and send what
 * it returns. `complete` carries packet 4 (with the embedded `clientinitiv`); after
 * sending it the low-level init is done and the crypto handshake continues.
 */
export class Init1Handshake {
    private readonly _version: Buffer;
    private readonly _clientInitIv: Buffer;
    private readonly _random: (size: number) => Buffer;
    private _a0: Buffer | null = null;
    private _phase: number = 0;

    public constructor(
        version: Buffer,
        clientInitIv: Buffer,
        random: (size: number) => Buffer = randomBytes,
    ) {
        this._version = version;
        this._clientInitIv = clientInitIv;
        this._random = random;
    }

    /** Build and return the first client packet (packet 0). */
    public start(timestampSeconds: number): Buffer {
        this._a0 = this._random(4);
        this._phase = 1;
        return wrapClientInit1(buildPacket0(this._version, timestampSeconds, this._a0));
    }

    /** Feed one server Init1 packet and get the next action. */
    public onServerPacket(raw: Buffer): Init1Outcome {
        let data: Buffer;
        try {
            data = unwrapInit1(PacketDirection.ServerToClient, raw);
        } catch (error: unknown) {
            return { kind: 'error', message: (error as Error).message };
        }
        const step: number = data[0] ?? 0xff;

        if (this._phase === 1 && step === STEP_S_COOKIE) {
            const { a1, a0Reversed } = parsePacket1(data);
            this._phase = 2;
            return {
                kind: 'send',
                packet: wrapClientInit1(buildPacket2(this._version, a1, a0Reversed)),
            };
        }
        if (this._phase === 2) {
            if (step === STEP_RESTART) {
                this._phase = 0;
                return { kind: 'restart' };
            }
            if (step === STEP_S_PUZZLE) {
                const puzzle: Init1Puzzle = parsePacket3(data);
                const y: Buffer = solveRsaPuzzle(puzzle.x, puzzle.n, puzzle.level);
                this._phase = 3;
                return {
                    kind: 'complete',
                    packet: wrapClientInit1(
                        buildPacket4(
                            this._version,
                            puzzle.x,
                            puzzle.n,
                            puzzle.level,
                            puzzle.a2,
                            y,
                            this._clientInitIv,
                        ),
                    ),
                };
            }
        }
        return { kind: 'error', message: `Init1: unexpected step ${step} in phase ${this._phase}` };
    }

    public get phase(): number {
        return this._phase;
    }
}
