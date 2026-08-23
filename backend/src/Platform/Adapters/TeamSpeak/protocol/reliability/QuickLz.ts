import type { Buffer } from 'node:buffer';

/**
 * QuickLZ (level 1, streaming mode 0) — TS3's command compression
 * (`../PROTOCOL.md` §2.5). A **byte-compatible** port of TSLib's `QuickerLz.cs` is
 * a self-contained follow-up; until it lands:
 *
 * - Outbound: we never compress, so the Compressed (CP) flag is never set — every
 *   command we send goes out as-is. (Fine: compression is only a size optimization.)
 * - Inbound: a server *may* compress large notifies (e.g. the channel list). When a
 *   packet arrives with CP set, {@link quickLzDecompress} throws so the gap is loud
 *   rather than silently corrupting data.
 */

/** Decompress a QuickLZ blob. NOT IMPLEMENTED — throws (see module docs). */
export function quickLzDecompress(_data: Buffer): Buffer {
    throw new Error('QuickLz: decompression not implemented yet (server sent a Compressed packet)');
}

/** Whether QuickLZ compression is available for outbound packets (currently no). */
export const QUICKLZ_COMPRESS_AVAILABLE: boolean = false;
