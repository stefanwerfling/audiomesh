# AudioMesh — API

figtree exposes **GET/POST only**, so mutations are POST actions (not REST verbs).
All endpoints are under `/api/v1`. Bodies + responses are validated against the
shared `@audiomesh/schemas` vts schemas.

## REST

| Method | Path | Body → Response |
|---|---|---|
| GET | `/system/health` | → `Health` |
| GET | `/system/metrics` | → `Metrics` |
| GET | `/system/logs` | → `LogList` |
| POST | `/auth/login` | `LoginBody` → `LoginResult` (bearer token) |
| GET | `/auth/me` | (Bearer) → `AuthState` |
| GET | `/sessions/list` | → `Session[]` |
| GET | `/sessions/get?id=` | → `Session \| null` |
| POST | `/sessions/start` | `SessionStartBody` → `Session` |
| POST | `/sessions/stop` | `{ sessionId }` → `ApiResult` |
| GET | `/platforms/list` | → `Platform[]` |
| POST | `/platforms/create` | `PlatformBody` → `Platform` |
| POST | `/platforms/update?id=` | `PlatformBody` → `Platform \| null` |
| POST | `/platforms/delete?id=` | → `ApiResult` |
| POST | `/platforms/test?id=` | → `PlatformTestResult` |
| GET | `/routes/list` | → `AudioRoute[]` |
| POST | `/routes/create` | `AudioRouteBody` → `AudioRoute` |
| POST | `/routes/update?id=` | `AudioRouteBody` → `AudioRoute \| null` |
| POST | `/routes/{start,stop,delete}?id=` | → `ApiResult` |
| GET | `/agents/list` | → `AgentProfile[]` |
| POST | `/agents/create` | `AgentProfileBody` → `AgentProfile` |
| POST | `/agents/update?id=` | `AgentProfileBody` → `AgentProfile \| null` |
| POST | `/agents/delete?id=` | → `ApiResult` |
| GET | `/settings/state` | → `Settings` (secrets redacted) |
| POST | `/settings/save` | `SettingsBody` → `Settings` |
| POST | `/settings/openai-test` | → `OpenAiTestResult` |

The OpenAI API key is write-only: `save` accepts it, `state` never returns it (an
empty `apiKey` on save leaves the stored key untouched).

## WebSocket — `/api/ws`

Broadcast-only, server → client. Each frame is a JSON `WsEvent`, discriminated on
`type`:

```jsonc
{ "type": "transcript.final", "timestamp": 123, "sessionId": "…",
  "line": { "speakerId": "…", "text": "Hallo", "language": "de", "final": true, "timestamp": 123 } }
```

Types: `session.connected`, `session.disconnected`, `session.state`,
`participant.joined`, `participant.left`, `speech.started`, `speech.stopped`,
`transcript.partial`, `transcript.final`, `audio.route.started`,
`audio.route.stopped`, `agent.response`, `system.error`.
