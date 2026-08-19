# AudioMesh

A modular **voice-agent and audio-routing platform** written entirely in TypeScript.
AudioMesh joins voice communication systems as an autonomous agent, receives and
processes audio in real time, routes it between platforms, and transcribes speech —
all administered from a web dashboard. **No CLI.**

It is explicitly **not a simple Discord bot**: Discord, TeamSpeak 3 and Jitsi are
just interchangeable *platform adapters* behind a common core. Adding a new
platform must never require changing the core.

> Status: **Phase 1 (Foundation) complete.** Backend (figtree/Express), REST +
> WebSocket, streaming audio core, event bus, mock voice adapter, and the
> bambooo/AdminLTE dashboard all build and run. Discord + OpenAI land in the next
> phases — see [ROADMAP.md](ROADMAP.md).

## Monorepo

npm workspaces, build order `schemas → backend → frontend`:

| Workspace | What |
|---|---|
| `@audiomesh/schemas` | Shared [vts](https://github.com/OpenSourcePKG/vts) DTOs + types (REST bodies, WS events) — one source of truth for backend + frontend. |
| `@audiomesh/backend` | [figtree](https://github.com/stefanwerfling/figtree) (Express 5) API, WebSocket, streaming audio core, platform adapters, TypeORM/SQLite. |
| `@audiomesh/frontend` | bambooo + AdminLTE 3 + Bootstrap 5 dashboard (webpack/gulp). Served by the backend. |

## Quick start

```bash
npm install
npm run build                       # schemas → backend → frontend

cp backend/config.example.json backend/config.json
npm run start -w @audiomesh/backend # serves API + dashboard on https://localhost:3901
```

Open `https://localhost:3901` (the dev server uses a self-signed certificate —
accept it in the browser). Default login: `admin` / `admin` (override via
`AUDIOMESH_ADMIN_PASSWORD`).

Dev mode with live reload:

```bash
npm run dev:backend      # tsx watch
npm run dev:frontend     # gulp watch (webpack)
```

## Docs

- [ARCHITECTURE.md](ARCHITECTURE.md) — layers, core interfaces, audio pipeline, events.
- [CONFIGURATION.md](CONFIGURATION.md) — config.json, env vars (only the DB is configured outside the UI).
- [API.md](API.md) — REST endpoints + WebSocket events.
- [DEVELOPMENT.md](DEVELOPMENT.md) — build order, house code style, testing.
- [ROADMAP.md](ROADMAP.md) — the seven phases.

## License

ISC © Stefan Werfling
