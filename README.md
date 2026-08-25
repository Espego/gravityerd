# GravityERD

GravityERD is an offline-first, client-side database schema explorer. It combines a deterministic fCoSE bootstrap with a continuously adjustable gravity model, manual placement, pins, domains, custom views, relationship groups, relationship highlighting, and draw.io export.

No backend, CDN, telemetry, database rows, or imported schema metadata leave the browser. The static build is suitable for GitHub Pages.

Hosted application: `https://espego.github.io/gravityerd/`

In the UI, **schema** means refreshable database structure and **workspace** means views, gravity settings, positions, and pins. A workspace can be exported with its schema for a self-contained file, or without it when the schema is managed separately. The version 1 JSON kind names remain compatible.

## Project status

GravityERD is developed primarily for the author's own use and is published as-is. There is no commitment to ongoing maintenance, support, a public roadmap, compatibility fixes, or response times. Issues and contributions may be considered when time and interest permit, but users should be prepared to maintain their own fork.

## Run locally

All development commands run in Docker Compose:

```sh
make up
```

Open `http://127.0.0.1:18116`. The foreground process removes its containers when it exits or receives Ctrl-C. Override the port with `GRAVITYERD_PORT=18126 make up`.

Use `make up-detached` only when the server should remain running until `make down`.

```sh
make test
make security
```

Test targets remove their containers even after an interruption. Named dependency caches remain for faster subsequent runs; `make clean` removes containers and project volumes. Default Compose memory and CPU limits can be overridden with `GRAVITYERD_NODE_MEMORY`, `GRAVITYERD_PLAYWRIGHT_MEMORY`, and their corresponding `_CPUS` variables.

## Create a schema file

GravityERD never connects to a database. Give an agent a schema-only DDL file or metadata obtained with your own trusted database tools, then ask it to produce `gravityerd-project` JSON according to the public format.

The exact PostgreSQL/MySQL workflow, stable-ID rules, mapping, validation checklist, and a ready-to-use agent prompt are in `docs/schema-authoring.md`. Schema metadata may itself be sensitive; keep the DDL and generated JSON local.

## Files and automation

- `docs/formats.md` documents the public JSON formats.
- `docs/schema-authoring.md` explains how to create schema JSON without giving GravityERD database access.
- `docs/physics.md` explains the layout model and controls.
- `docs/playwright-mcp.md` is the supported Playwright MCP and human-review workflow.
- `docs/security-review.md` records the security model, remediated findings, and residual risks.
- `automation-contract.json` is the machine-readable stable UI contract.
- `?example=helpdesk` opens the public synthetic example.

In supported secure-context browsers, GravityERD registers feature-detected `gravityerd_*` WebMCP tools through `document.modelContext`. The versioned `globalThis.gravityErdAutomation` API remains a compatible fallback for Playwright environments that execute in the actual page realm. Both surfaces reuse the same validation and merge functions: proposals are visible, fingerprint-bound, and require explicit configuration, layout, and pin choices. `getProjectJson()` and `getWorkspaceJson()` return exports directly for terminal-side file writing. See `llms.txt`, `automation-contract.json`, and `docs/playwright-mcp.md` for the complete contract.

The repository is MIT licensed. Report vulnerabilities through the private process in `SECURITY.md`.
