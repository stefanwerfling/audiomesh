# AudioMesh — Configuration

**Only the database (and HTTP server) is configured outside the web frontend.**
Everything else — OpenAI, platforms, agents, routes, privacy — is edited in the
dashboard and stored in `<dataDir>/audiomesh-store.json`.

## `backend/config.json`

Copy `backend/config.example.json`. Loaded by figtree at boot.

```jsonc
{
    "httpserver": { "port": 3901, "publicdir": "../frontend" },
    "db": {},
    "logging": { "enableConsole": true, "level": "info", "dirname": "./logs" },
    "dataDir": "./data",
    "database": { "kind": "sqlite", "file": "./data/audiomesh.db" }
}
```

- `httpserver.publicdir` — the built frontend the backend serves. figtree serves
  over **HTTPS** with a self-signed cert unless you provide one via `sslpath`.
- `database.kind` — `sqlite` (MVP) or `mariadb` (multi-instance later). Same
  TypeORM entities either way; `mariadb` takes `host/port/database/username/password`.

## Environment variables (deploy-time infra only)

| Var | Purpose |
|---|---|
| `AUDIOMESH_DATA_DIR` | Override `dataDir`. |
| `AUDIOMESH_DATABASE_KIND` | `sqlite` \| `mariadb`. |
| `AUDIOMESH_DATABASE_FILE` | SQLite file path. |
| `AUDIOMESH_DATABASE_HOST/_PORT/_NAME/_USER/_PASSWORD` | MariaDB connection. |
| `AUDIOMESH_ADMIN_USER` / `AUDIOMESH_ADMIN_PASSWORD` | Local admin login (default `admin`/`admin` — **change in production**). |
| `AUDIOMESH_JWT_SECRET` | HMAC secret for bearer tokens (random per boot if unset). |

App settings (OpenAI key, models, voice, platforms, agents, routes, privacy) are
**never** env-driven — they belong to the frontend.

## Platform config (per platform, stored in the dashboard)

A platform's `config` is an opaque key/value bag whose shape depends on `kind`.

### Jitsi (`kind: "jitsi"`)

A headless bot joins a Jitsi Meet conference using our **vendored**
`lib-jitsi-meet` build (see below) and receives each participant's WebRTC audio as
per-speaker PCM.

| Key | Required | Default | Purpose |
|---|---|---|---|
| `domain` | ✅ | — | Jitsi host, e.g. `meet.example.com` (scheme + path stripped, so a pasted meeting URL works). |
| `mucDomain` | | `conference.<domain>` | XMPP MUC host. |
| `anonymousDomain` | | `guest.<domain>` | Guest XMPP host for secure-domain servers — lets the bot join without a password (the room must already be open by an authenticated host). |
| `bosh` | | `https://<domain>/http-bind` | BOSH endpoint (the connection transport). |
| `websocket` | | — | XMPP-over-WebSocket URL; preferred over BOSH when set. |
| `displayName` | | `AudioMesh` | Name the bot shows in the conference. |
| `authUser` / `authPassword` | | — | Login for secured (authenticated) deployments. |
| `startMuted` | | `true` | Join with the mic muted (a transcription bot rarely speaks). |

The **channel** is the room name, passed when a session starts (Jitsi has no
server-side room directory — rooms are created on demand at join).

The bot both **receives** (per-speaker `IAudioSource`s) and can **talk back**:
audio written to the session's send sink (agent TTS, or a cross-platform route)
is upsampled to the WebRTC rate and pushed into the bot's local track. `startMuted`
sets the initial state; `mute()`/`unmute()` gate outbound audio at runtime.

Membership is **live**: participants who join or leave after the session starts are
added/removed on the fly, and Jitsi's dominant-speaker signal drives the per-speaker
"who's talking" state (`SpeechStarted`/`SpeechStopped`) shown in the dashboard.

**Our own vendored lib-jitsi-meet.** The npm `lib-jitsi-meet` package is a dead
end (deprecated at 1.0.6, crashes under Node), so we don't use it. Instead we
vendor the exact `lib-jitsi-meet.min.js` a Jitsi deployment ships at
`<server>/libs/lib-jitsi-meet.min.js` and load it **headless** under Node —
`JitsiRuntime` provides the browser-environment shim (`jsdom` for the DOM,
`@roamhq/wrtc` for WebRTC + the `RTCAudioSink`/`RTCAudioSource` audio path, `ws`
for the XMPP WebSocket). Those three are **regular backend dependencies** (already
installed), and the bundle lives in `backend/vendor/jitsi/`.

To (re-)vendor the bundle from a server whose version you want to match:

```
npm run update:jitsi-lib -w @audiomesh/backend -- https://<your-jitsi-server>
```

This fetches the bundle + LICENSE and records provenance (source URL, size,
sha256) in `backend/vendor/jitsi/version.json`.

To verify a live connection end-to-end (the counterpart to the unit tests, which
use a fake client and never hit the network):

```
npx tsx backend/scripts/jitsi-smoke.mjs <domain> [room] [seconds]
```

With no room it verifies connect-only (as a guest); with a room it joins and
reports every participant and inbound audio frame. All conversion logic (48 kHz →
internal 16 kHz PCM, per-speaker framing) is dependency-free and unit-tested.

## Live transcription (OpenAI STT)

Per-speaker streaming transcription runs when a session is started with
transcription **enabled** and an OpenAI key is configured (Settings → OpenAI).
Each speaker's audio streams to OpenAI's Realtime transcription API; interim and
final lines arrive over WebSocket as `TranscriptPartial` / `TranscriptFinal`. The
transcription model is the Settings `transcriptionModel` (default
`gpt-4o-transcribe`); the API key is backend-only. No key or transcription
enabled → sessions still run, just without transcripts.

## Secrets & privacy

- The OpenAI API key is stored server-side and never returned to the frontend
  (the UI only shows `Configured / Not configured`).
- Recording and transcript storage default **OFF**; retention is configurable.
  When `privacy.recordingEnabled` is on, one WAV per participant (internal
  16 kHz mono PCM) is written to `<dataDir>/recordings/<sessionId>/<user>.wav` —
  platform-agnostic, gated centrally (not per platform). A recording failure is
  logged and isolated; it never interrupts the live session.
- No audio content or keys are ever logged. Secrets never go in git
  (`config.json`, `data/`, `.env` are gitignored).
