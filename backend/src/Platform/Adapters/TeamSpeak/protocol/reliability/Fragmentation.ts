import { Buffer } from 'node:buffer';
import { hasFlag, PacketFlags } from '../packet/PacketType.js';

/**
 * Command fragmentation and reassembly (`../PROTOCOL.md` §2.5). Only
 * Command/CommandLow may be split. When the (optionally compressed) payload
 * exceeds one packet's data budget it is cut into fragments: the Fragmented (FR)
 * flag marks the **first and last** fragment, Newprotocol (NP) is set on **all**
 * fragments, and Compressed (CP)/Unencrypted (UE) are meaningful only on the first
 * (they describe the whole reassembled payload). Voice is never fragmented.
 */

/** Max data bytes in one client→server packet: 500 − 8 (MAC) − 5 (header). */
export const MAX_DATA_C2S: number = 487;
/** Max data bytes in one server→client packet: 500 − 8 (MAC) − 3 (header). */
export const MAX_DATA_S2C: number = 489;

/** One outgoing fragment: the payload slice and the flag bits its header carries. */
export interface OutgoingFragment {
    data: Buffer;
    flags: number;
}

/**
 * Split a command payload into fragments of at most `maxChunk` data bytes. A
 * payload that fits one packet yields a single, non-fragmented packet. `compressed`
 * / `unencrypted` set CP/UE — applied only to the first fragment. NP is always set.
 */
export function fragmentCommand(
    payload: Buffer,
    maxChunk: number,
    options: { compressed?: boolean; unencrypted?: boolean } = {},
): OutgoingFragment[] {
    if (maxChunk <= 0) {
        throw new Error('Fragmentation: maxChunk must be positive');
    }
    let firstFlags: number = PacketFlags.Newprotocol;
    if (options.compressed === true) {
        firstFlags |= PacketFlags.Compressed;
    }
    if (options.unencrypted === true) {
        firstFlags |= PacketFlags.Unencrypted;
    }

    if (payload.length <= maxChunk) {
        return [{ data: payload, flags: firstFlags }];
    }

    const fragments: OutgoingFragment[] = [];
    for (let offset: number = 0; offset < payload.length; offset += maxChunk) {
        const slice: Buffer = payload.subarray(offset, offset + maxChunk);
        const isFirst: boolean = offset === 0;
        const isLast: boolean = offset + maxChunk >= payload.length;
        let flags: number = PacketFlags.Newprotocol;
        if (isFirst) {
            flags = firstFlags | PacketFlags.Fragmented;
        } else if (isLast) {
            flags |= PacketFlags.Fragmented;
        }
        fragments.push({ data: slice, flags: flags });
    }
    return fragments;
}

/** A reassembled command payload plus whether it still needs QuickLZ decompression. */
export interface ReassembledCommand {
    payload: Buffer;
    compressed: boolean;
}

/**
 * Reassembles incoming Command/CommandLow packets fed **in packet-id order**. A
 * standalone (non-FR) packet completes immediately; an FR-marked packet starts a
 * run that completes at the next FR-marked packet. The `compressed` flag is taken
 * from the first packet of the run.
 */
export class FragmentReassembler {
    private _assembling: boolean = false;
    private _compressed: boolean = false;
    private _parts: Buffer[] = [];

    /**
     * Feed one packet's flags + data. Returns the completed payload when this
     * packet finishes a command, or null while a fragmented run is still open.
     */
    public push(flags: number, data: Buffer): ReassembledCommand | null {
        const fragmented: boolean = hasFlag(flags, PacketFlags.Fragmented);
        if (!this._assembling) {
            if (!fragmented) {
                return { payload: data, compressed: hasFlag(flags, PacketFlags.Compressed) };
            }
            // First fragment of a run.
            this._assembling = true;
            this._compressed = hasFlag(flags, PacketFlags.Compressed);
            this._parts = [data];
            return null;
        }

        this._parts.push(data);
        if (fragmented) {
            // Last fragment — complete the run.
            const payload: Buffer = Buffer.concat(this._parts);
            const compressed: boolean = this._compressed;
            this._reset();
            return { payload: payload, compressed: compressed };
        }
        return null;
    }

    /** True while a fragmented run is open (awaiting its final FR packet). */
    public get assembling(): boolean {
        return this._assembling;
    }

    private _reset(): void {
        this._assembling = false;
        this._compressed = false;
        this._parts = [];
    }
}
