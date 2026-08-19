# AudioMesh — Development

## Prerequisites

Node 24+, npm 11+. `npm install` (native `better-sqlite3` builds during install).
If a transitive install script fails in a sandbox, `npm install --ignore-scripts`
(the sqlite native binary is prebuilt).

## Build order

`schemas → backend → frontend` (a workspace imports the built output of the
previous one).

```bash
npm run build            # all workspaces, in order
npm run typecheck        # tsc --noEmit across workspaces
npm run lint             # eslint .
npm run format           # prettier --write .
npm test                 # vitest (backend)
```

Per workspace: `npm run build -w @audiomesh/backend`, etc. Backend dev:
`npm run dev:backend` (tsx watch). Frontend dev: `npm run dev:frontend`
(gulp watch → webpack; refresh the browser).

## House code style

- **OOP-only**: logic lives in classes; singletons via `getInstance()`.
- **English-only** source, comments, logs.
- 4-space indent, single quotes, semicolons, explicit member accessibility +
  return types (Prettier + flat ESLint enforce it).
- `type: module` + `module: Node16` → **imports need the `.js` extension** even
  from `.ts` sources (`import { X } from './X.js'`).
- Never `console.log` in the backend — use figtree `Logger.getLogger()` /
  `this.getLogger()`.
- No premature abstraction; duplicate until a third caller appears.

## Testing

Vitest under `backend/test/` mirroring `src/`. The core is testable **without a
real voice platform** via `MockVoiceAdapter`. Install a temp `ConfigStore` and
register the mock adapter in `beforeEach` (see
`test/Session/VoiceSessionManager.test.ts`).

## Frontend build note

bambooo's v2 barrel re-exports optional Map/PDF/Scanner widgets pulling heavy deps
(OpenLayers, pdfjs-dist, …). AudioMesh uses none of them, so `webpack.config.js`
`IgnorePlugin`s those requests instead of installing them.
