# GravityERD project guidance

- Keep the application fully client-side. Do not add a backend, telemetry, CDN, or network upload for imported data.
- Preserve public format compatibility. Update `schemas/`, `docs/formats.md`, `automation-contract.json`, examples, and round-trip tests together.
- Browser automation normally mutates state through real UI controls. The only non-UI exception is the versioned `globalThis.gravityErdAutomation` workspace/schema proposal API; keep it two-phase, fingerprint-bound, visible in the proposal dialog, and routed through the same validation and merge functions as UI imports. View creation uses stable schema IDs and applies workspace configuration without replacing layout or pins.
- Keep schema IDs independent of a development/production database name and never introspect row data.
- Use Docker Compose project `gravityerd` for development, builds, exporters, and tests.
- Do not commit credentials, database URLs, real schemas containing sensitive names, or row data.
- Run the relevant Compose checks and inspect `git status` after commits.
