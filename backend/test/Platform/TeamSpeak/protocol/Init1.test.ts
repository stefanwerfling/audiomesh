import { Buffer } from 'node:buffer';
import { describe, expect, it } from 'vitest';
import {
    buildPacket1,
    buildPacket3,
    encodeClientVersion,
    Init1Handshake,
    type Init1Outcome,
    parsePacket1,
    parsePacket3,
    TS3_VERSION_EPOCH,
    unwrapInit1,
    wrapServerInit1,
} from '../../../../src/Platform/Adapters/TeamSpeak/protocol/init1/Init1.js';
import {
    bufferToBigInt,
    solveRsaPuzzle,
} from '../../../../src/Platform/Adapters/TeamSpeak/protocol/init1/RsaPuzzle.js';
import { PacketDirection } from '../../../../src/Platform/Adapters/TeamSpeak/protocol/packet/Ts3Packet.js';

const VERSION: Buffer = encodeClientVersion(TS3_VERSION_EPOCH + 0x063bece9);
const A1: Buffer = Buffer.alloc(16, 0xa1);
const X: Buffer = Buffer.alloc(64, 0);
const N: Buffer = Buffer.alloc(64, 0xff);
X[63] = 2; // base = 2
const LEVEL: number = 5;
const A2: Buffer = Buffer.alloc(100, 0xa2);
const CLIENT_INIT_IV: Buffer = Buffer.from('clientinitiv alpha=... omega=... ot=1 ip');

/** Deterministic "random" so A0 is predictable in tests. */
const fixedRandom = (size: number): Buffer => Buffer.alloc(size, 0x5a);

describe('encodeClientVersion', () => {
    it('encodes unixSeconds − epoch as u32 BE', () => {
        expect(encodeClientVersion(TS3_VERSION_EPOCH + 0x063bece9).toString('hex')).toBe(
            '063bece9',
        );
        expect(encodeClientVersion(TS3_VERSION_EPOCH).readUInt32BE(0)).toBe(0);
    });
});

describe('Init1 payload builders/parsers', () => {
    it('packet 1 round-trips through parse', () => {
        const a0r: Buffer = Buffer.from([1, 2, 3, 4]);
        const parsed = parsePacket1(buildPacket1(A1, a0r));
        expect(Buffer.compare(parsed.a1, A1)).toBe(0);
        expect(Buffer.compare(parsed.a0Reversed, a0r)).toBe(0);
    });

    it('packet 3 round-trips through parse', () => {
        const parsed = parsePacket3(buildPacket3(X, N, LEVEL, A2));
        expect(Buffer.compare(parsed.x, X)).toBe(0);
        expect(Buffer.compare(parsed.n, N)).toBe(0);
        expect(parsed.level).toBe(LEVEL);
        expect(Buffer.compare(parsed.a2, A2)).toBe(0);
    });

    it('rejects a malformed step byte', () => {
        expect(() => parsePacket1(Buffer.alloc(21, 0))).toThrow(/malformed/);
        expect(() => parsePacket3(Buffer.alloc(233, 0))).toThrow(/malformed/);
    });
});

describe('Init1Handshake state machine', () => {
    it('drives packet 0 → 2 → 4, embedding the solved puzzle and clientinitiv', () => {
        const hs: Init1Handshake = new Init1Handshake(VERSION, CLIENT_INIT_IV, fixedRandom);

        // Packet 0.
        const p0raw: Buffer = hs.start(1_700_000_000);
        const p0: Buffer = unwrapInit1(PacketDirection.ClientToServer, p0raw);
        expect(p0[4]).toBe(0x00); // step byte
        expect(hs.phase).toBe(1);

        // Server replies packet 1; A0-reversed echoes the client's A0 (all 0x5a).
        const a0Reversed: Buffer = Buffer.alloc(4, 0x5a);
        const out1: Init1Outcome = hs.onServerPacket(wrapServerInit1(buildPacket1(A1, a0Reversed)));
        expect(out1.kind).toBe('send');
        if (out1.kind !== 'send') {
            throw new Error('expected send');
        }
        const p2: Buffer = unwrapInit1(PacketDirection.ClientToServer, out1.packet);
        expect(p2[4]).toBe(0x02);
        expect(Buffer.compare(p2.subarray(5, 21), A1)).toBe(0); // echoes A1

        // Server replies packet 3 (the puzzle); client must complete with packet 4.
        const out2: Init1Outcome = hs.onServerPacket(
            wrapServerInit1(buildPacket3(X, N, LEVEL, A2)),
        );
        expect(out2.kind).toBe('complete');
        if (out2.kind !== 'complete') {
            throw new Error('expected complete');
        }
        const p4: Buffer = unwrapInit1(PacketDirection.ClientToServer, out2.packet);
        expect(p4[4]).toBe(0x04);
        // y sits after the 233-byte head; verify it equals the puzzle solution.
        const y: Buffer = p4.subarray(233, 233 + 64);
        expect(bufferToBigInt(y)).toBe(bufferToBigInt(solveRsaPuzzle(X, N, LEVEL)));
        // clientinitiv is appended after y.
        expect(p4.subarray(233 + 64).toString()).toBe(CLIENT_INIT_IV.toString());
    });

    it('signals a restart when the server sends step 0x7F', () => {
        const hs: Init1Handshake = new Init1Handshake(VERSION, CLIENT_INIT_IV, fixedRandom);
        hs.start(1_700_000_000);
        hs.onServerPacket(wrapServerInit1(buildPacket1(A1, Buffer.alloc(4, 0x5a))));
        const restart: Buffer = wrapServerInit1(
            Buffer.concat([Buffer.from([0x7f]), Buffer.alloc(20)]),
        );
        expect(hs.onServerPacket(restart).kind).toBe('restart');
    });

    it('errors on an unexpected step for the current phase', () => {
        const hs: Init1Handshake = new Init1Handshake(VERSION, CLIENT_INIT_IV, fixedRandom);
        hs.start(1_700_000_000);
        const bogus: Buffer = wrapServerInit1(
            Buffer.concat([Buffer.from([0x03]), Buffer.alloc(232)]),
        );
        expect(hs.onServerPacket(bogus).kind).toBe('error');
    });
});
