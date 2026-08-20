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

_STT done._ `OpenAITranscriptionProvider` streams each speaker's audio to OpenAI's
Realtime transcription WebSocket (server-VAD) and emits `TranscriptPartial` /
`TranscriptFinal` events → WS → UI. The socket sits behind an
`IRealtimeTranscriptionSession` seam (`OpenAIRealtimeTranscriptionSession` real
impl over `ws`; a fake drives unit tests), so the provider and the manager wiring
are testable without a network. The manager starts transcription per participant
(incl. late joiners) when the session's `transcriptionEnabled` is set **and** a
key is configured; internal 16 kHz PCM is resampled to OpenAI's 24 kHz. Key stays
backend-only (`OpenAIProvider.testConnection` now does a real `GET /v1/models`).
Still open: LLM (`complete`) + TTS for the agent (Phase 7).

## Phase 4 — Frontend live transcription ✅ (complete)

Session detail (`frontend/.../Pages/Sessions.ts`): participant list with a live
speaking badge toggled directly by `speech.started/stopped`; a live transcript
pane where each speaker's interim `transcript.partial` updates **one line in
place** (blinking caret) and `transcript.final` commits it and clears the partial
— no flooding. Header shows the connection state plus an **STT status pill**
(off / no-OpenAI-key / active / error) derived from `transcriptionEnabled`, the
cached OpenAI-configured flag and live `system.error` events. All via the shared
`/api/ws` stream — no polling.

## Phase 5 — Audio routing ✅ (complete)

`AudioRouter` now really moves frames: it resolves a route's nodes
(source → processors → sink) via an injectable `IRouteNodeResolver`
(`SessionRouteResolver`) and wires them through an `AudioPipeline`. A source
session's mixed audio (`FanInAudioSource` over its participant sources) flows,
optionally through a `GainAudioProcessor`, into a target session's adapter
`sendAudio()` — cross-platform (e.g. Jitsi → TeamSpeak). Many routes run in
parallel, each its own pipeline; resolve/start failures are isolated (route
`failed` + `ErrorOccurred`). Routing UI picks source + target session (+ gain),
shows the readable chain and live run-state over WebSocket.

## Phase 6 — TeamSpeak 3 + Jitsi

Each strictly behind `IVoicePlatformAdapter`; core unchanged.

_Jitsi landed early:_ `JitsiAdapter` joins a conference as a headless
`lib-jitsi-meet` bot and republishes each participant's WebRTC track as an
internal-format `IAudioSource`. Jitsi/WebRTC specifics sit behind an `IJitsiClient`
seam (`LibJitsiClient` real impl; a fake client drives unit tests), and audio
conversion is reusable, dependency-free `PcmResampler` + `PcmFrameAssembler`
(48 kHz Int16 → internal 16 kHz s16le). We ship our **own vendored** lib-jitsi-meet
(the npm package is a dead end): `JitsiRuntime` loads the server's real
`lib-jitsi-meet.min.js` bundle from `backend/vendor/jitsi/` headless under Node via
a `jsdom`/`@roamhq/wrtc`/`ws` shim — **live guest connect over BOSH verified**
against a real secure-domain deployment (see CONFIGURATION.md; `jitsi-smoke.mjs`).
Outbound talkback is wired too: `sendAudio()` returns a real sink that upsamples
internal 16 kHz → the client's 48 kHz native rate and chunks to 10 ms frames,
gated by `mute()/unmute()` state; `LibJitsiClient` publishes a wrtc
`RTCAudioSource`-backed local track. Dynamic membership + speaking now work too:
adapters expose an `IAdapterEventListener` (`setEventListener`) and the
`VoiceSessionManager` materialises/tears down a `Participant` + pipeline per live
join/leave; Jitsi's `DOMINANT_SPEAKER_CHANGED` maps to `SpeechStarted/Stopped` +
`SpeakerChanged` and per-participant `speakingState`. Opt-in recording is done:
gated by the global `privacy.recordingEnabled`, the manager swaps each
participant's null sink for a `WavRecorderSink` writing one WAV per speaker under
`<dataDir>/recordings/<sessionId>/` (platform-agnostic, fault-isolated). Still
open: confirm remote-audio receive and local-track (talkback) publish against a
live conference with a real host in the room — the guest connect itself is verified.

TeamSpeak 3 still pending — spike the TS3 audio path (highest risk) next.

## Phase 7 — AI Voice Agent

VAD → STT → context → LLM → TTS → voice output. Agent profiles (system prompt,
model, voice, tools) assignable per session from the UI.
