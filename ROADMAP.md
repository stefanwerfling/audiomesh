# AudioMesh — Roadmap

Live tracking lives in Synaipse (project `audiomesh`); this is the summary.

## Phase 1 — Foundation ✅ (complete)

TypeScript monorepo, figtree backend, REST + WebSocket, streaming audio core
(`IAudioSource/Processor/Sink`, `AudioPipeline`), typed `EventBus`, `VoiceSession`
+ `Participant` + manager, `IVoicePlatformAdapter` + `PlatformRegistry`,
`MockVoiceAdapter`, `AudioRouter`, JSON `ConfigStore`, local auth, bambooo/AdminLTE
dashboard (Dashboard, Sessions + live transcript, Platforms, Routes, Agents,
Transcripts, Settings, System) with live WebSocket updates. Vitest suite green.

_Remaining in Phase 1:_ wire TypeORM/SQLite entities for opt-in session/transcript
storage; enforce the auth token on every route.

## Phase 2 — Discord (first real platform)

`DiscordAdapter` via `@discordjs/voice`: connect, join, detect participants,
receive per-user Opus → `prism-media` decode → internal PCM, real-time audio
events. (Discord first — audio receive works out of the box; TeamSpeak/Jitsi are
harder. See the Synaipse decision note.)

## Phase 3 — OpenAI (STT / LLM / TTS)

`OpenAIProvider` + `OpenAITranscriptionProvider` (official SDK, Realtime API for
streaming STT), partial + final transcripts. Key stays backend-only.

## Phase 4 — Frontend live transcription

Session detail: participants + live partial/final transcript with speaker +
connection/OpenAI status over WebSocket.

## Phase 5 — Audio routing

`AudioSource → Processor → Sink → Route` runtime moving frames across platforms,
multiple parallel routes (e.g. Discord → AudioMesh → TeamSpeak), simple routing UI.

## Phase 6 — TeamSpeak 3 + Jitsi

Each strictly behind `IVoicePlatformAdapter`; core unchanged. Spike the TS3 audio
path first (highest risk).

## Phase 7 — AI Voice Agent

VAD → STT → context → LLM → TTS → voice output. Agent profiles (system prompt,
model, voice, tools) assignable per session from the UI.
