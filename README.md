# GravityERD

GravityERD is an offline-first, client-side database schema explorer. It combines a deterministic fCoSE bootstrap with a continuously adjustable gravity model, manual placement, pins, domains, custom views, relationship groups, relationship highlighting, and draw.io export.

No backend, CDN, telemetry, database rows, or imported schema metadata leave the browser. The static build is suitable for GitHub Pages.

Hosted application: `https://espego.github.io/gravityerd/`

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

Test targets remove their containers even after an interruption. Named dependency caches remain for faster subsequent runs; `make clean` removes containers and project volumes. Default Compose memory and CPU limits can be overridden with `GRAVITYERD_NODE_MEMORY`, `GRAVITYERD_DATABASE_MEMORY`, `GRAVITYERD_GO_MEMORY`, `GRAVITYERD_PLAYWRIGHT_MEMORY`, and their corresponding `_CPUS` variables.

## Export a schema

The exporter performs read-only metadata introspection. Credentials are read only from `DATABASE_URL` and are never written to the JSON.

```sh
docker compose run --rm -e DATABASE_URL schema-export \
  postgres --schema public --output /output/schema.gravityerd.json

docker compose run --rm -e DATABASE_URL schema-export \
  mysql --database app --output /output/schema.gravityerd.json
```

Mount a writable local directory at `/output` when overriding the Compose service. Repeat `--exclude-table table_name` to omit tables.

Files written by the exporter are replaced atomically with owner-only permissions. Standard output is unchanged.
For a non-local database, configure certificate-verified TLS in `DATABASE_URL`; disable TLS only on an isolated local development network.

## Files and automation

- `docs/formats.md` documents the public JSON formats.
- `docs/physics.md` explains the layout model and controls.
- `docs/playwright-mcp.md` is the supported Playwright MCP and human-review workflow.
- `docs/security-review.md` records the security model, remediated findings, and residual risks.
- `automation-contract.json` is the machine-readable stable UI contract.
- `?example=helpdesk` opens the public synthetic example.

Agents without file chooser or clipboard access can use the versioned `globalThis.gravityErdAutomation` API from Playwright evaluation. `proposeImport()` accepts serialized project/workspace JSON and opens the normal visible proposal; `applyImportProposal()` requires its exact fingerprint and explicit configuration, layout, and pin choices. `getProjectJson()` and `getWorkspaceJson()` return exports directly for terminal-side file writing. See `llms.txt`, `automation-contract.json`, and `docs/playwright-mcp.md` for the complete contract.

The repository is MIT licensed. Report vulnerabilities through the private process in `SECURITY.md`.
