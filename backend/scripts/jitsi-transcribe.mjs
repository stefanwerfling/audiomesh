/**
 * Live end-to-end transcription smoke test: a headless bot joins a real Jitsi
 * conference, and every participant's audio is transcribed per-speaker via an
 * OpenAI-compatible gateway (e.g. Pegenaut's Whisper) using the pause-segmenting
 * batch path. Prints each final line as it arrives and a chronological report at
 * the end — "HH:MM:SS  Name: text" — so you can see who said what, when.
 *
 * Per-speaker separation is inherent: JitsiAdapter.receiveAudio(id) yields one
 * IAudioSource per participant, and the provider runs one segmenting session each.
 *
 * Usage (tsx, no build needed):
 *   PEGENAUT_API_KEY=pgn_... \
 *   npx tsx scripts/jitsi-transcribe.mjs konferenz.pegenau.de <room> [seconds]
 *
 * Env:
 *   PEGENAUT_API_KEY    (required) Bearer key for the gateway
 *   PEGENAUT_BASE_URL   (default https://pegenaut-test.pegenau.de)
 *   STT_MODEL           (default whisper)
 *
 * A host must be in the room and speaking for anything to transcribe.
 */
import { rmSync } from 'node:fs';
import { JitsiAdapter } from '../src/Platform/Adapters/Jitsi/JitsiAdapter.js';
import { LibJitsiClient } from '../src/Platform/Adapters/Jitsi/LibJitsiClient.js';
import { ConfigStore } from '../src/Store/ConfigStore.js';
import { OpenAITranscriptionProvider } from '../src/Transcription/OpenAITranscriptionProvider.js';

const domain = process.argv[2] || process.env.JITSI_DOMAIN || 'konferenz.pegenau.de';
const room = process.argv[3] || process.env.JITSI_ROOM;
const seconds = Number(process.argv[4] || process.env.JITSI_SECONDS || 120);
const baseUrl = process.env.PEGENAUT_BASE_URL || 'https://pegenaut-test.pegenau.de';
const apiKey = process.env.PEGENAUT_API_KEY || '';
const sttModel = process.env.STT_MODEL || 'whisper';

if (!room) {
    console.error(
        'usage: PEGENAUT_API_KEY=... npx tsx scripts/jitsi-transcribe.mjs <domain> <room> [seconds]',
    );
    process.exit(2);
}
if (!apiKey) {
    console.error('PEGENAUT_API_KEY is required (Bearer key for the gateway)');
    process.exit(2);
}

const log = (m) => console.log(`[transcribe] ${new Date().toISOString()} ${m}`);
const hhmmss = (ms) => new Date(ms).toLocaleTimeString('de-DE', { hour12: false });

// Point AudioMesh's OpenAI providers at the gateway, in batch (segmenting) mode.
const storePath = `${process.env.TMPDIR || '/tmp'}/audiomesh-transcribe-store.json`;
ConfigStore.install(storePath);
ConfigStore.getInstance().saveSettings({
    openai: {
        apiKey,
        baseUrl,
        model: 'primary',
        transcriptionModel: sttModel,
        transcriptionMode: 'batch',
        ttsModel: 'tts',
        voice: 'alloy',
    },
    privacy: { recordingEnabled: false, transcriptStorageEnabled: false, retentionDays: 30 },
});
log(`gateway=${baseUrl} sttModel=${sttModel} mode=batch`);

const names = new Map(); // platformUserId -> displayName
const report = []; // { at, speaker, text }
const provider = new OpenAITranscriptionProvider();

function onResult(r) {
    const speaker = names.get(r.speakerId) ?? r.speakerId;
    report.push({ at: r.timestamp, speaker, text: r.text });
    console.log(`  ${hhmmss(r.timestamp)}  ${speaker}: ${r.text}`);
}

async function startFor(p) {
    if (names.has(p.platformUserId)) return;
    names.set(p.platformUserId, p.displayName);
    log(`transcribing ${p.displayName} (${p.platformUserId})`);
    try {
        await provider.start(p.platformUserId, adapter.receiveAudio(p.platformUserId), onResult);
    } catch (e) {
        log(`start failed for ${p.displayName}: ${e?.message ?? e}`);
    }
}

const adapter = new JitsiAdapter({ domain, startMuted: true }, (cfg) => new LibJitsiClient(cfg));
adapter.setEventListener({
    onParticipantJoined: (p) => void startFor(p),
    onParticipantLeft: (id) => {
        log(`participant left: ${names.get(id) ?? id}`);
        void provider.stop(id);
    },
    onSpeakingChanged: () => {},
});

async function main() {
    log('connecting …');
    await adapter.connect();
    log('✅ connected — joining room');
    await adapter.joinChannel(room);
    for (const p of await adapter.getParticipants()) await startFor(p);
    log(`✅ joined "${room}" — listening ${seconds}s (speak now!)`);

    await new Promise((resolve) => setTimeout(resolve, seconds * 1000));

    log('stopping — flushing trailing segments …');
    for (const id of names.keys()) await provider.stop(id);
    await adapter.disconnect();

    report.sort((a, b) => a.at - b.at);
    console.log('\n==================== REPORT ====================');
    if (report.length === 0) {
        console.log('(no speech transcribed — was anyone speaking?)');
    } else {
        for (const line of report) console.log(`${hhmmss(line.at)}  ${line.speaker}: ${line.text}`);
    }
    console.log('===============================================\n');
}

main()
    .then(() => {
        try {
            rmSync(storePath, { force: true });
        } catch {
            /* ignore cleanup errors */
        }
        process.exit(0);
    })
    .catch((e) => {
        try {
            rmSync(storePath, { force: true });
        } catch {
            /* ignore cleanup errors */
        }
        console.error(`[transcribe] FAILED: ${e?.stack ?? e?.message ?? e}`);
        process.exit(1);
    });
