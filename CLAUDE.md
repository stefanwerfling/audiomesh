# AudioMesh

## Language

Everything committed to this repository is written in **English** — code, comments, docs, commit messages, and notes.

## Use Synaipse (required)

This project uses **Synaipse** as its knowledge and memory system. The MCP server is configured in `.mcp.json` under the project scope `audiomesh` (`X-Synaipse-Project: audiomesh`).

### At session start
- **Always call `synaipse_prime` first** to load project context (pinned notes, recent sessions, decisions, open TODOs) before starting the actual work.
- Verify the active scope with `synaipse_get_project` (must be `audiomesh`).
- For a specific topic, use `synaipse_search` / `synaipse_related` instead of answering from memory.

### While working
- Capture new insights, architecture decisions, and durable facts with `synaipse_write_note` or `synaipse_remember` (scope `audiomesh`).
- Update existing notes with `synaipse_edit_note` / `synaipse_update_note` instead of creating duplicates.
- Link related notes with `synaipse_link_note` (`[[note-name]]`).
- Track open work through the roadmap/TODO tools (`synaipse_todos`, `synaipse_roadmap_*`).

### At session end
- Log a session with `synaipse_log_session` when there is meaningful progress.

**Principle:** Project knowledge belongs in Synaipse, not just in transient chat context. Look it up first, then act — and document what's new.