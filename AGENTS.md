# GravityERD project guidance

- Keep the application fully client-side. Do not add a backend, telemetry, CDN, or network upload for imported data.
- Preserve public format compatibility. Update `schemas/`, `docs/formats.md`, `automation-contract.json`, examples, and round-trip tests together.
- Browser automation mutates state only through real UI controls. `globalThis.gravityErdAutomation` stays read-only.
- Keep schema IDs independent of a development/production database name and never introspect row data.
- Use Docker Compose project `gravityerd` for development, builds, exporters, and tests.
- Do not commit credentials, database URLs, real schemas containing sensitive names, or row data.
- Run the relevant Compose checks and inspect `git status` after commits.
