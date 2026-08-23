import { Buffer } from 'node:buffer';
import { describe, expect, it } from 'vitest';
import {
    FragmentReassembler,
    fragmentCommand,
    MAX_DATA_C2S,
} from '../../../../src/Platform/Adapters/TeamSpeak/protocol/reliability/Fragmentation.js';
import {
    hasFlag,
    PacketFlags,
} from '../../../../src/Platform/Adapters/TeamSpeak/protocol/packet/PacketType.js';

describe('fragmentCommand', () => {
    it('emits a single non-fragmented packet when it fits', () => {
        const frags = fragmentCommand(Buffer.from('clientinit x=1'), MAX_DATA_C2S);
        expect(frags).toHaveLength(1);
        expect(hasFlag(frags[0]!.flags, PacketFlags.Fragmented)).toBe(false);
        expect(hasFlag(frags[0]!.flags, PacketFlags.Newprotocol)).toBe(true);
    });

    it('carries CP/UE only on the single packet when set', () => {
        const frags = fragmentCommand(Buffer.from('x'), MAX_DATA_C2S, {
            compressed: true,
            unencrypted: true,
        });
        expect(hasFlag(frags[0]!.flags, PacketFlags.Compressed)).toBe(true);
        expect(hasFlag(frags[0]!.flags, PacketFlags.Unencrypted)).toBe(true);
    });

    it('splits a large payload, FR on first and last only, NP on all', () => {
        const payload: Buffer = Buffer.alloc(MAX_DATA_C2S * 2 + 10, 0x41);
        const frags = fragmentCommand(payload, MAX_DATA_C2S);
        expect(frags).toHaveLength(3);
        expect(hasFlag(frags[0]!.flags, PacketFlags.Fragmented)).toBe(true);
        expect(hasFlag(frags[1]!.flags, PacketFlags.Fragmented)).toBe(false);
        expect(hasFlag(frags[2]!.flags, PacketFlags.Fragmented)).toBe(true);
        for (const f of frags) {
            expect(hasFlag(f.flags, PacketFlags.Newprotocol)).toBe(true);
        }
        // Only the first fragment carries CP.
        const compressed = fragmentCommand(payload, MAX_DATA_C2S, { compressed: true });
        expect(hasFlag(compressed[0]!.flags, PacketFlags.Compressed)).toBe(true);
        expect(hasFlag(compressed[1]!.flags, PacketFlags.Compressed)).toBe(false);
        expect(hasFlag(compressed[2]!.flags, PacketFlags.Compressed)).toBe(false);
    });

    it('round-trips through the reassembler', () => {
        const payload: Buffer = Buffer.from('A'.repeat(MAX_DATA_C2S * 2 + 123));
        const frags = fragmentCommand(payload, MAX_DATA_C2S);
        const reasm: FragmentReassembler = new FragmentReassembler();
        let result: { payload: Buffer; compressed: boolean } | null = null;
        for (const f of frags) {
            result = reasm.push(f.flags, f.data);
        }
        expect(result).not.toBeNull();
        expect(result?.payload.equals(payload)).toBe(true);
        expect(reasm.assembling).toBe(false);
    });
});

describe('FragmentReassembler', () => {
    it('completes a standalone packet immediately', () => {
        const reasm: FragmentReassembler = new FragmentReassembler();
        const out = reasm.push(PacketFlags.Newprotocol, Buffer.from('hello'));
        expect(out?.payload.toString()).toBe('hello');
        expect(out?.compressed).toBe(false);
    });

    it('takes the compressed flag from the first fragment of a run', () => {
        const reasm: FragmentReassembler = new FragmentReassembler();
        expect(
            reasm.push(
                PacketFlags.Newprotocol | PacketFlags.Fragmented | PacketFlags.Compressed,
                Buffer.from('a'),
            ),
        ).toBeNull();
        expect(reasm.assembling).toBe(true);
        const out = reasm.push(PacketFlags.Newprotocol | PacketFlags.Fragmented, Buffer.from('b'));
        expect(out?.payload.toString()).toBe('ab');
        expect(out?.compressed).toBe(true);
    });
});
