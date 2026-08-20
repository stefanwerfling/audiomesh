/**
 * Manual live smoke test for the vendored Jitsi path. Drives the *real*
 * {@link LibJitsiClient} against a running Jitsi deployment: loads our vendored
 * lib-jitsi-meet headless, connects as a guest (anonymous/secure domain), and —
 * if a room is given — joins it and reports every participant and inbound audio
 * frame it receives. This is the end-to-end counterpart to `npm test` (which
 * uses FakeJitsiClient and never touches the network).
 *
 * Run it with tsx so it reflects the current source, no build required:
 *
 *   npx tsx scripts/jitsi-smoke.mjs <domain> [room] [seconds]
 *   npx tsx scripts/jitsi-smoke.mjs konferenz.pegenau.de pegenau5 20
 *
 * A room must already be open by a real host for participant/audio events to
 * flow; with no room it verifies connect-only. Exit code is non-zero on failure.
 */
import { LibJitsiClient } from '../src/Platform/Adapters/Jitsi/LibJitsiClient.js';
import { parseJitsiConfig } from '../src/Platform/Adapters/Jitsi/JitsiConfig.js';

const domain = process.argv[2] || process.env.JITSI_DOMAIN;
const room = process.argv[3] || process.env.JITSI_ROOM;
const seconds = Number(process.argv[4] || process.env.JITSI_SECONDS || 20);

if (!domain) {
    console.error('usage: npx tsx scripts/jitsi-smoke.mjs <domain> [room] [seconds]');
    process.exit(2);
}

function log(msg) {
    console.log(`[jitsi-smoke] ${new Date().toISOString()} ${msg}`);
}

async function main() {
    const config = parseJitsiConfig({ domain: domain });
    log(`config: domain=${config.domain} muc=${config.mucDomain} anon=${config.anonymousDomain}`);
    log(`serviceUrl=${config.websocket ?? config.bosh}`);

    const client = new LibJitsiClient(config);

    // Count inbound frames per participant so we can prove audio is really flowing.
    const framesByParticipant = new Map();
    client.setHandlers({
        onParticipantJoined: (p) => log(`participant joined: ${p.displayName} (${p.id})`),
        onParticipantLeft: (id) => log(`participant left: ${id}`),
        onDominantSpeakerChanged: (id) => log(`dominant speaker: ${id ?? '(none)'}`),
        onAudioData: (d) => {
            framesByParticipant.set(
                d.participantId,
                (framesByParticipant.get(d.participantId) ?? 0) + 1,
            );
        },
        onError: (msg) => log(`ERROR: ${msg}`),
    });

    log('connecting …');
    await client.connect();
    log('✅ CONNECTION_ESTABLISHED');

    if (room) {
        log(`joining room "${room}" …`);
        await client.joinRoom(room);
        log(`✅ CONFERENCE_JOINED — listening ${seconds}s for audio`);
        await new Promise((resolve) => setTimeout(resolve, seconds * 1000));

        if (framesByParticipant.size === 0) {
            log('no audio frames received (is anyone speaking / is the room open?)');
        } else {
            for (const [id, frames] of framesByParticipant) {
                log(`audio: ${frames} frames from ${id}`);
            }
        }
        log('leaving room …');
        await client.leaveRoom();
    }

    log('disconnecting …');
    await client.disconnect();
    log('done');
}

main()
    .then(() => process.exit(0))
    .catch((e) => {
        console.error(`[jitsi-smoke] FAILED: ${e?.stack ?? e?.message ?? e}`);
        process.exit(1);
    });
