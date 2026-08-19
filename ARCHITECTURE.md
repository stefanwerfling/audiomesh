# AudioMesh — Architecture

## Guiding rule

**Adding a new voice platform must not require touching the core.** A platform is
a class implementing `IVoicePlatformAdapter`, registered in the `PlatformRegistry`.
The core resolves adapters by kind and never contains platform-specific logic.

## Layers

Three workspaces (house style): `schemas` (shared DTOs), `backend` (all core logic
as OOP directories), `frontend` (dashboard). Backend directories:

```
backend/src/
├── Core/        EventBus (typed), domain event map, MetricsCollector
├── Audio/       AudioFormat (PCM s16le/mono/16k), IAudioSource/Processor/Sink, AudioPipeline
├── Routing/     AudioRouter (parallel routes, run-state; graph-ready)
├── Platform/    IVoicePlatformAdapter, PlatformRegistry, Adapters/MockVoiceAdapter
├── Session/     Participant, VoiceSession, VoiceSessionManager
├── Transcription/ ITranscriptionProvider  (OpenAI impl in Phase 3)
├── Ai/          IAIProvider, OpenAIProvider (stub → Phase 3)
├── Auth/        AuthService (local admin, HMAC bearer token, role model)
├── Store/       ConfigStore (JSON persistence for everything except the DB)
└── Server/      figtree App, ConfigSchema, RouteLoader, Routes/, Ws/ (Hub, Endpoint, EventBridge)
```

## Core interfaces

- **`IVoicePlatformAdapter`** — `connect/disconnect`, `joinChannel/leaveChannel`,
  `getChannels/getParticipants`, `receiveAudio(participantId): IAudioSource`,
  `sendAudio(): IAudioSink`, `mute/unmute`. Impl: `MockVoiceAdapter` (now),
  Discord/TeamSpeak/Jitsi (later).
- **Audio (streaming, never file-based)** — `IAudioFrame` (PCM buffer + timestamp
  + optional speakerId), `IAudioSource` (push), `IAudioProcessor`
  (`process → frame | null`), `IAudioSink`. `AudioPipeline` wires
  `source → processors[] → sink`, fault-isolated per frame.
- **Routing** — `AudioRouter` owns many parallel routes; route definitions are a
  node chain (source → processors → sink), already a DAG edge-list so the future
  visual graph editor is additive.
- **Sessions** — `VoiceSession` (state machine emitting `SessionStateChanged`) +
  per-participant `IAudioSource` (enables speaker-attributed transcription).
- **AI/transcription behind interfaces** — OpenAI is the only impl; the API key is
  backend-only and the frontend only ever sees `apiKeyConfigured`.

## Event flow

Everything domain-worthy is emitted on the typed **`EventBus`**. The
**`WsEventBridge`** subscribes and forwards the *frontend-relevant subset* to the
browser over `/api/ws` as `WsEvent` DTOs (raw audio-chunk events never cross it).
The `WsHub` fans a broadcast to every connected socket. The frontend `WsClient`
narrows on `event.type` and updates the UI live — **no polling**.

```
Adapter → VoiceSession/Manager → EventBus → WsEventBridge → WsHub → /api/ws → WsClient → UI
```

## Configuration split

Per project rule: **only the database is configured outside the frontend**
(config.json / env, because you need a DB before the app can run). OpenAI,
platforms, agents, routes and privacy are all edited in the dashboard and
persisted by the `ConfigStore` (a JSON file under `dataDir`). Session/transcript
persistence (opt-in) moves to TypeORM/SQLite.

## Fault isolation (hard requirements)

- An OpenAI failure must not kill the voice connection.
- A transcription failure must not end the session.
- An adapter failure must not crash the process or other sessions.

Each subsystem try/catches at its boundary and emits `ErrorOccurred` instead of
throwing up the stack.

## Real-time / performance

Streaming end-to-end (internal PCM s16le mono 16 kHz — the format OpenAI expects),
no whole-utterance buffering, bounded queues with drop-oldest for live audio,
per-hop latency surfaced as metrics. Optimise only after profiling.
