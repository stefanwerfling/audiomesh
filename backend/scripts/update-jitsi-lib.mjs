/**
 * Update the vendored lib-jitsi-meet bundle to match a Jitsi deployment.
 *
 *   node scripts/update-jitsi-lib.mjs [baseUrl]
 *   JITSI_LIB_SOURCE=https://meet.example.com node scripts/update-jitsi-lib.mjs
 *
 * Every Jitsi server ships the exact lib-jitsi-meet build it runs at
 * `<base>/libs/lib-jitsi-meet.min.js` — so we vendor *that* file (version match
 * with the bridge, already built) instead of the deprecated npm package. The
 * bundle is loaded headless by `JitsiRuntime`; this script only fetches + records
 * provenance in `version.json`. Default source is meet.jit.si.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const VENDOR = join(HERE, '..', 'vendor', 'jitsi');
const BASE = (process.argv[2] || process.env.JITSI_LIB_SOURCE || 'https://meet.jit.si').replace(
    /\/+$/,
    '',
);

async function get(url, binary) {
    const res = await fetch(url);
    if (!res.ok) {
        throw new Error(`GET ${url} -> ${res.status} ${res.statusText}`);
    }
    return binary ? Buffer.from(await res.arrayBuffer()) : await res.text();
}

async function main() {
    mkdirSync(VENDOR, { recursive: true });
    const bundleUrl = `${BASE}/libs/lib-jitsi-meet.min.js`;
    console.log(`Fetching ${bundleUrl} …`);
    const bundle = await get(bundleUrl, true);
    writeFileSync(join(VENDOR, 'lib-jitsi-meet.min.js'), bundle);

    try {
        const license = await get(`${bundleUrl}.LICENSE.txt`, false);
        writeFileSync(join(VENDOR, 'lib-jitsi-meet.min.js.LICENSE.txt'), license);
    } catch (e) {
        console.warn(`(no LICENSE file: ${e.message})`);
    }

    const sha256 = createHash('sha256').update(bundle).digest('hex');
    const meta = {
        source: bundleUrl,
        bytes: bundle.length,
        sha256: sha256,
        fetchedAt: new Date().toISOString(),
        note: 'Official lib-jitsi-meet build vendored from a Jitsi deployment. Apache-2.0. Loaded headless by JitsiRuntime.',
    };
    writeFileSync(join(VENDOR, 'version.json'), `${JSON.stringify(meta, null, 4)}\n`);
    console.log(`Vendored ${bundle.length} bytes, sha256 ${sha256.slice(0, 12)}…`);
    console.log(`Wrote ${join(VENDOR, 'version.json')}`);
}

main().catch((e) => {
    console.error(`update-jitsi-lib failed: ${e.message}`);
    process.exit(1);
});
