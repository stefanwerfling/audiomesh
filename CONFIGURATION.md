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

## Secrets & privacy

- The OpenAI API key is stored server-side and never returned to the frontend
  (the UI only shows `Configured / Not configured`).
- Recording and transcript storage default **OFF**; retention is configurable.
- No audio content or keys are ever logged. Secrets never go in git
  (`config.json`, `data/`, `.env` are gitignored).
