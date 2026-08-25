# GravityERD security review

Review date: 2026-08-25

## Scope and trust boundaries

The review covers the browser application, JSON import and export, draw.io generation, IndexedDB workspace storage, browser automation surfaces, the local static server, Docker Compose, and GitHub Actions/Pages workflows.

GravityERD never receives database credentials. Project and workspace JSON are untrusted after file selection. The browser must not upload imported content, and the static deployment has no backend, telemetry, CDN, or third-party runtime dependency.

## Remediated findings

| ID | Severity | Finding | Remediation |
| --- | --- | --- | --- |
| GERD-01 | Medium | Imported labels, tooltips, and colors could reach draw.io HTML/style fields without separate context handling. | HTML and XML are escaped independently, style colors are reduced to safe six-digit hex values, and hostile export fixtures are tested. |
| GERD-03 | Medium | Local Compose exposed the development server on every host interface and the static response lacked defense-in-depth headers. | Host publication is loopback-only; the direct server also defaults to loopback and emits CSP, frame, MIME, referrer, permission, and cross-origin headers. GitHub Pages receives an equivalent CSP through HTML metadata. |
| GERD-04 | Medium | Imported physics values, especially the fCoSE iteration count, could cause excessive client computation. | Every numeric setting is clamped to the finite range exposed by the UI; iteration count is capped at 600. |
| GERD-05 | Medium | GitHub Actions used movable major tags and checkout credentials remained available to later steps. | Official actions are pinned to verified commit SHAs, checkout credential persistence is disabled, and permissions are assigned per job. |
| GERD-06 | Low | A malformed encoded URL could terminate the local server request handler. | URL decoding failures return 400; traversal attempts and unsupported methods have explicit responses and tests. |
| GERD-08 | Low | A direct automation mutation surface could bypass import review or apply a stale proposal. | Workspace and schema-only methods accept bounded JSON strings, always open a visible normal proposal, return a fingerprint, and require that exact fingerprint plus explicit merge choices before applying through the shared UI path. Schema refresh rejects workspace merge choices. |
| GERD-09 | Medium | A browser-native agent tool could introduce a second mutation path or expose imported metadata without clear trust annotations. | WebMCP is a feature-detected adapter over the same frozen automation facade, mutating tools retain the visible proposal/fingerprint/apply flow, read-only tools are annotated, imported-content outputs are marked untrusted, and registration failure is non-fatal. |

## Retired component history

- GERD-02 and GERD-07 applied to the former database-connected Go exporter. The exporter, its image, database drivers, and database test services were removed; GravityERD now documents how agents can transform schema-only output created by the user's own trusted tooling.

## Validation

The release gate runs JavaScript unit tests, desktop and mobile Playwright scenarios, the production build, `npm audit --audit-level=moderate`, and a tracked-content secret signature scan. CI and every local test target tear down project containers after success, failure, or interruption.

## Accepted Low risks

- A deliberately selected, extremely large JSON file can still consume browser memory before semantic normalization. The file chooser is an explicit local trust decision; hard format-size limits would reject legitimate large schemas. The terminal automation API has a separate 16 MiB per-document limit.
- Schema metadata can itself contain sensitive identifiers, comments, defaults, or constraint text. GravityERD never inspects rows or uploads the metadata, but users must treat exported project files as schema-sensitive artifacts.
- GitHub Pages cannot set the server-level `frame-ancestors` header. The local server sends it; the hosted client has no authenticated backend or remotely state-changing action.
- The automation mutation methods are intentionally callable by code already executing in the application origin. CSP, local-only dependencies, context-safe rendering, and the absence of third-party scripts reduce that path; a same-origin script compromise would already control the client and its IndexedDB state. The API adds no backend or network upload capability.
