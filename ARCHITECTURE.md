# CIE — Architecture and Project Context

> Living decision record. M0/M1 history and current M2 implementation are described below.

- **Project:** AI Codebase Intelligence Engine (**CIE**, working label; no finalized product name)
- **Model:** local-first localhost web app. No hosted/Vercel runtime for local code analysis.
- **Stage:** M0 completed; M1 repository explorer approved by owner; M2 reviewed PASS WITH ISSUES, targeted correction awaiting re-review before M3.
- **Design source:** https://chatgpt.com/share/6addfe15-6604-83ee-865a-89701c1623fd
- **Primary UI spec:** [`docs/UI_DESIGN_SPEC.md`](docs/UI_DESIGN_SPEC.md)
- **Current date for decision log:** 2026-10-25

## Why this exists

CIE lets a developer open a local repository and understand its architecture, real dependency relationships and code impact through an interactive 3D code graph, an alternate 2D view and optional AI explanations. Core deterministic capabilities should work without paid API keys.

## Goals

1. Real repository/file relationships, not generated guesses; traceable sources for every graph edge.
2. Local source code stays local by default; explicit consent before any optional AI provider transmission in later milestones.
3. High-performance 3D spatial exploration with visible file/folder names, path context, actual connection lines, structure-based clustering and camera controls; alternate 2D view consumes the same graph.
4. Code intelligence (import graph, cycles, impact, structural metrics) deterministic without LLMs where practical.
5. Deliberate, original visual design inspired by the _art direction_ of Clair Obscur: Expedition 33; no copied assets or characters.
6. Incremental project milestones; avoid premature work and misleading mock analysis.

## Non-goals for M0 (historical scope)

File ingestion, Git clone, AST parsing, real graphs, Three.js/R3F scene, 2D graph layout, inspector real data, AI API integration, accounts, Vercel hosting, desktop installer. These are phased later.

## Architecture (M0 baseline and planned extensions)

```text
                      Browser on localhost
                              │
               React + TS application shell (Vite :5173)
                 │          │          │
           Navigation    Design system  Stage region
                 │                     │
                 └────── HTTP local API ┘
                            │
                      127.0.0.1 only
                            │
                     Node / Fastify API (:3001)
                            │
                     /api/v1/health       <--- M0
                            │
              [Future M1+ local ingestion]
                            │
              [Future M2+ dependency model]
                            │
              [Future M3/M4 views share graph]
                            │
              [Future M7 optional LLM adapter]
```

Client never gets arbitrary filesystem access simply by running in a browser. Future local server reads are validated by backend and are explicit user actions. Telemetry and provider calls are opt-in only if implemented later.

M0 baseline: `apps/web` rendered an honest empty workspace and Settings; it checked `/api/v1/health` on entry, every 30 seconds and on manual retry. Vite proxies `/api` to the Fastify loopback server during development. A malformed response, failed request or 5-second timeout displays disconnected. Both dev servers bind `127.0.0.1`. The M0-only API route was `GET /api/v1/health` returning exactly `{ "status": "ok", "mode": "local", "version": "0.1.0" }`. The frontend still renders without the API.

## Code boundaries

- `apps/web`: React+TypeScript view/state, responsive shell; no direct Node FS or secret persistence.
- `apps/server`: localhost-only HTTP API, M1 repository read boundary and M2 bounded static analysis/graph service.
- `packages/shared` (if useful): DTOs and discriminated API types; no overengineering for one health endpoint.
- `docs/`: design decisions, QA and milestone notes. Root `ARCHITECTURE.md` is source of truth for implementation evolution.

Implemented: pnpm 10.34.8 workspaces on Node 20.19+ (verified on Node 24.19.0); React 19.3.1, TypeScript 5.9.3 strict, Vite 7.3.7, Fastify 5.x, ESLint 9, Prettier 3, Vitest 3. The lockfile pins transitive versions. `apps/server` compiles to `dist` for Node; Vite builds `apps/web/dist`. No shared package is needed for a single health DTO. `Three.js` + stable React-compatible `@react-three/fiber` remains a candidate for M3, not an M0 dependency.

## Future graph contract (design sketch, not an M0 schema commitment)

```ts
type FileNode = {
  id: string; // normalized, stable repo-relative identity
  path: string; // repository-relative, not leaked outside local environment
  kind: "file" | "directory";
  language?: string;
  groupPath?: string; // actual directory grouping
};

type DependencyEdge = {
  source: string; // importer/referrer node ID
  target: string; // referenced module/file node ID
  relation: "import" | "export" | "reference";
  evidence?: { file: string; line?: number };
  resolution: "resolved" | "unresolved" | "external";
};
```

Edges will have deterministic traceability where supported; unresolved/external imports are distinct. M3 and M4 should use a shared graph store, not different invented graph models. Exact schema, cross-language resolution and persistence are deferred to M2.

## Security/trust baseline

- Loopback bind by default; frontend and API not reachable from LAN/internet unless an intentional future decision changes this.
- M1 file access endpoints require rigorous path boundaries, canonicalization and symlink handling, strict input validation, and explicit selections; never expose arbitrary paths on a wildcard bind.
- Later API endpoints must consider DNS rebinding, Host and Origin validation, CORS allowlist and CSRF/cross-origin requests, especially when write actions appear.
- M0 only health endpoint; no arbitrary file endpoint, no upload, no external calls after install, no analytics, no LLM secrets.
- Health endpoint must be accurate, not simulate readiness when server unreachable.
- M0 ships no CORS headers or cross-origin permission; the web app uses the same-origin dev proxy. Loopback binding alone does not stop hostile local pages from issuing blind requests. Before M1 filesystem routes, enforce Host/Origin allowlists and DNS-rebinding defenses, canonical path boundaries, symlink handling, permissions and explicit selection on the server.

## UI design invariants

- **Old** Elden Ring influence is superseded by **original Expedition 33-inspired** painterly/editorial treatment.
- Dark/near-black base and restrained metallic accents; readable warm neutrals, not a gold-filled fantasy theme.
- No characters, kingdoms, castles or false fantasy world scene; code structure _is_ the view.
- Real 3D spatial graph and named file-to-file connections in M3; meaningful hierarchy; eventual 2D mode.
- **Do not call the product “Cinder Archive.”** `CIE` is temporary neutral working name.
- M0 shows true empty states, with future controls clearly deferred. See UI spec.

## Milestones and deliverables

| Milestone | Scope                                                                                                   | Gate                                                              |
| --------- | ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| **M0**    | Monorepo/tooling, local API, design system, polished empty-state app shell, docs                        | install/dev/build/typecheck/lint/tests run; truthful local status |
| **M1**    | local repository ingestion, directory tree, ignore handling                                             | browse a real local repo                                          |
| **M2**    | import/relationship parser and graph model — PASS WITH ISSUES; import-equals correction awaiting review | explainable nodes & edges; tests and real-repo trial below        |
| **M3**    | interactive 3D file graph, camera and labels                                                            | browse real dependencies in spatial depth                         |
| **M4**    | alternate 2D graph and synchronized navigation                                                          | both modes operate on same graph                                  |
| **M5**    | non-LLM code intelligence                                                                               | dependency metrics, impact and cycles                             |
| **M6**    | file inspector and source references                                                                    | accurate source/detail navigation                                 |
| **M7**    | optional LLM adapter/retrieval                                                                          | explicit opt-in, grounded explanations                            |
| **M8**    | performance, security hardening, DX                                                                     | realistic repo scale and robust failures                          |
| **M9**    | tests, docs, distribution/release                                                                       | runnable tested v1.0                                              |

## Decision log (append; never silently rewrite)

| ID      | Date       | Decision                                                                                   | Reason / impact                                                                                                                                                           | Status                            |
| ------- | ---------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| ADR-001 | 2026-10-25 | Localhost-first browser UI backed by a local server                                        | Protect local repository, avoid hosted compute limits, enable native FS access through controlled backend                                                                 | Accepted                          |
| ADR-002 | 2026-10-25 | Replace Elden Ring visual direction with original Expedition 33-inspired art direction     | Explicit latest user preference; old visual treatments are not requirements                                                                                               | Accepted / supersedes prior theme |
| ADR-003 | 2026-10-25 | File graph is the centerpiece; not kingdom/landscape                                       | User requires explicit file labels and edges grouped by real directory structure                                                                                          | Accepted                          |
| ADR-004 | 2026-10-25 | 3D primary with 2D alternate mode                                                          | Spatial relationships plus easier overview; same factual graph                                                                                                            | Accepted, implementation M3/M4    |
| ADR-005 | 2026-10-25 | M0 honest shell only; do not mock working graphs                                           | Avoid deceptive UX, deliver foundational quality                                                                                                                          | Accepted                          |
| ADR-006 | 2026-10-25 | Default React/Vite + Fastify + pnpm proposed, not implemented                              | Lightweight local web stack; agent may honor compatible pre-existing repo stack                                                                                           | Superseded by ADR-008             |
| ADR-007 | 2026-10-25 | Use CIE as working label; no invented permanent name                                       | User rejected assistant-invented “Cinder Archive”                                                                                                                         | Accepted                          |
| ADR-008 | 2026-10-25 | Implement pnpm workspace with React/Vite web and Fastify loopback API                      | Empty initial repo; strict TypeScript, same-origin dev proxy, one root dev command; versions and checks recorded above                                                    | Accepted                          |
| ADR-009 | 2026-10-25 | No shared DTO package, CORS middleware or graph renderer in M0                             | One stable health route and no repository data; postpone abstractions and privilege-bearing routes until needed                                                           | Accepted                          |
| ADR-010 | 2026-10-25 | Original dark editorial empty stage; OS-managed reduced motion                             | Supersedes Elden Ring theme without invented nodes, artwork or nonfunctional mode switching                                                                               | Accepted                          |
| ADR-011 | 2026-10-25 | Gate every HTTP request with exact loopback Host and Origin allowlists; JSON-only mutation | Prevent browser-origin and DNS-rebinding access before any privileged file route. Absent Origin permits CLI clients; local processes remain trusted by OS, not this gate. | Accepted                          |
| ADR-012 | 2026-10-25 | Latest-request-wins health hook with abort, timeout and unmount cleanup                    | Replaces race-prone interval/ retry overlap; stale success or error cannot replace newer state.                                                                           | Accepted                          |
| ADR-013 | 2026-10-25 | CI checks on main pushes and pull requests with Node 22 and pinned pnpm                    | Reproducible installation, typecheck, lint, tests, build and formatting without credentials.                                                                              | Accepted                          |

M0 validation: `pnpm install`, `pnpm typecheck`, `pnpm lint`, `pnpm test` (2 API + 3 UI tests), `pnpm build`; `pnpm dev`, direct health and proxied health were exercised on loopback. Browser review covered 1440, 1024, 768, 375 and 320 CSS-pixel widths. See `docs/screenshots/` for desktop/mobile samples.

Phase A upgrade (M1 prerequisite): `apps/web/src/useLocalHealth.ts` owns the poll/retry lifecycle; `Workspace.tsx` and `Settings.tsx` separate pages without a router or new state framework. `apps/server/src/app.ts` rejects any Host except `127.0.0.1:3001` or the proxy-allowed `127.0.0.1:5173`, and any supplied Origin except `http://127.0.0.1:5173` or `http://127.0.0.1:3001`; absent Origin is allowed for CLI callers. All mutations require `Content-Type: application/json`, with no CORS permissions. Default request logging omits the raw URL to avoid leaking future path queries. CI workflow: [`.github/workflows/ci.yml`](.github/workflows/ci.yml). No filesystem route is introduced in this phase.

## M1 running path and trust boundary

```text
React repository tree (selection, expansion, paging, metadata, refresh)
  -> same-origin /api Vite proxy -> Fastify exact Host/Origin and JSON mutation gate
  -> one in-memory selected canonical root and opaque ID/revision
  -> validated relative paths and canonical containment; reject symlinks
  -> bounded lazy directory scan and root/nested .gitignore evaluation
  -> local filesystem (metadata and names only; no file content or graph edges)
```

`apps/server/src/repository.ts` alone reads filesystem metadata and ignore files. Selection requires a deliberately supplied absolute local directory, rejects symlink roots, canonicalizes with `realpath` and stores one active root per server process. A browser folder chooser cannot yield the local absolute path needed by this localhost server; manual entry is explicit. The server returns only basename, opaque ID and revision, never the absolute root. All tree requests carry ID/revision; old tabs/selections are rejected. A rescan increments revision, and the frontend clears its visible listings and refetches. Restart clears the selection. The client does not persist root paths.

Before `realpath`, paths are normalized repo-relative strings (`.` or POSIX segments, no traversal, backslashes, percent escapes or NUL); after resolution, canonical containment is checked against the selected root using `path.relative`, not string prefix. `lstat` rejects symlinks before `stat` reads metadata or `opendir` opens a directory. Because filenames can be replaced between checks, this mitigates but does not eliminate filesystem TOCTOU attacks from another local process; this is not a sandbox. Errors are structured and omit raw path, raw OS error and file content. One user's server session is the security scope: there are no remote accounts or per-tab isolated repositories.

`GET /api/v1/repository` reports selection; `POST /api/v1/repository/select` accepts a JSON absolute path; `GET /api/v1/repository/tree` accepts repo-relative `dir`, ID, revision, optional bounded `limit` (default 100, max 200) and opaque page `cursor`; `POST /api/v1/repository/rescan` takes JSON `{}`; `DELETE /api/v1/repository` takes JSON `{}`. Expected failures use a stable error code/message pair. List pages sort directories first then names, filter built-in generated/secret paths and `.gitignore` rules, and return a cursor tied to the root ID/revision/directory. Each directory scan stops at 5,000 entries; each ignore file is capped at 256 KiB. No Git index tracking, global excludes, `.git/info/exclude` or watching. `.env.example` remains visible; other `.env*`, `.git`, `node_modules`, build artifacts and caches are hidden even if negated in an ignore file. Nested ignore negation works only if parent remains traversable. Failures do not silently return a partial directory.

The frontend has distinct no-selection, loading, empty, paged, error and disconnected states. A file opens a metadata-only inspector (relative path, size, timestamp and basic extension hint); it never displays source or invents dependency relationships. Graph/Insights/AI remain disabled. No M2 dependency parser, M3 3D, M4 2D, M5 metrics, M6 source inspector or M7 AI is implemented.

M1 verification: frozen-lockfile install, `pnpm typecheck`, `pnpm lint`, `pnpm test` (13 server + 9 web tests), `pnpm build` and `pnpm format:check` ran locally. The live Vite proxy and direct loopback API were exercised against a temporary directory, including ignored files, nested tree, refresh, stale revision, deselection, hostile Host/Origin, text/plain mutation, traversal and symlink denial. Browser review checked selection, metadata, refreshed file visibility and no horizontal overflow at 320, 375, 768, 1024 and 1440 CSS-pixel widths. Captures: [`docs/screenshots/m1-desktop.png`](docs/screenshots/m1-desktop.png) and [`docs/screenshots/m1-mobile.png`](docs/screenshots/m1-mobile.png). Remote CI status and Windows behavior are unverified.

| ID      | Date       | Decision                                                       | Alternatives / impact / risk                                                                                                                                        | Status   |
| ------- | ---------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| ADR-014 | 2026-10-25 | Manual explicit absolute-path selection                        | Browser folder chooser does not supply a server-readable absolute path; no implicit home-directory scan or uploaded files. Local path entry is less convenient.     | Accepted |
| ADR-015 | 2026-10-25 | One in-memory root, opaque ID/revision and lazy paginated tree | Avoid persistent path storage, eager recursive scans, watchers and state framework. Restart loses selection; huge directories return an error rather than truncate. | Accepted |
| ADR-016 | 2026-10-25 | Canonical root containment and refuse symlink traversal        | Both lexical and `realpath` checks rather than prefix checks; no intentional traversal via links. Replacement races remain outside a robust OS sandbox.             | Accepted |
| ADR-017 | 2026-10-25 | Gitignore/nested rules via the `ignore` package                | One targeted dependency instead of a fragile custom parser; built-in sensitive/generated hides cannot be negated. Global Git ignores and index flags are deferred.  | Accepted |
| ADR-018 | 2026-10-25 | Return only metadata, not source or graph                      | Keep M1 truthful and local. Dependency edges require M2 evidence; source inspector is M6.                                                                           | Accepted |

## Open decisions (not blockers to M1)

- Final product name/brand identity beyond working label `CIE`.
- Exact screenshots of preferred final UI can further refine token values and component shapes; explicit user corrections take priority.
- Native directory chooser integration and a stricter capability sandbox, if later required by distribution threat model.
- M2 initial language/schema choice is recorded in ADR-019 below; additional languages remain deferred.
- M3 graph layout and rendering-performance strategy.
- M7 choice of external vs local LLM providers and opt-in details.

## Document maintenance protocol

1. Before any significant change, read this file.
2. Append a dated ADR with alternatives considered and impact; update diagrams, stack, roadmap and actual status.
3. If changing UI direction, update `UI_DESIGN_SPEC.md` and log supersession. If changing executable commands, update README and checklist.
4. After each milestone, record validated tests, known issues, and deferred scope. **Never declare an unimplemented milestone complete.**

## M2 source graph — implemented for independent review

`apps/server/src/repository.ts` reuses M1's selected-root, nested `.gitignore`, generated/secret exclusions, canonical containment and Host/Origin gate for an explicit `POST /api/v1/repository/analyze` with JSON `{repositoryId, revision}`. `GET /api/v1/repository/graph` returns the last analysis for that selection/revision, or structured `NO_GRAPH` (409). There is no source-content endpoint or frontend graph view. Selection, deselection and rescan invalidate the graph; failed reanalysis retains the last published graph. The service is single-session, in-memory and loopback-only; it is not a multi-user authentication system.

The supported inputs are UTF-8 `.ts`, `.tsx`, `.mts`, `.cts`, `.js`, `.jsx`, `.mjs`, `.cjs`. `typescript`'s `createSourceFile` parses captured bytes as data, never executing repository code. Only top-level static ES import/export-from declarations form edges. Relative paths resolve to an exact file, a unique supported extension/index module, or a unique TypeScript source behind a `.js`/`.mjs`/`.cjs` output specifier. Multiple candidates remain unresolved; bare specifiers are external; `require()` and `import()` produce dynamic diagnostics, not verified edges. TypeScript `import name = require("...")` and qualified import-equals aliases produce `UNSUPPORTED_IMPORT_SYNTAX` with a source line and set `partial: true`; neither is silently promoted to a file edge. No tsconfig aliases, package exports, type-checking, symbol graph, cross-language inference, Git history or runtime tracing. Malformed files, including AST nesting overflows, become failed nodes with parse diagnostics; valid siblings remain available. Unsupported/binary files are skipped (binary sources receive `UNSUPPORTED_ENCODING`).

Graph v1 (`apps/server/src/graph.ts`) returns sorted `directories`, named `files` (path, name, parent, language, status, SHA-256, deterministic path ID), directed `edges` (from/to, kind, resolution, specifier, evidence path/1-based line/column/rule/source SHA-256), `diagnostics`, `counts`, `partial`, `schemaVersion`, `analyzerVersion`, `manifest`, and selection ID/revision. The manifest hashes sorted captured path/content hashes; edges and file IDs do not use time or random values. Selection ID/revision are a session envelope and must be excluded when comparing normalized content across independent selections. Duplicate declarations at different source locations remain distinct evidence; directory containment is not a dependency. An edge's SHA-256 pins the source bytes used to calculate its line. No immutable source-content retrieval exists yet; a later inspector must verify this hash or retain captured bytes rather than read changed live content as the cited snapshot.

Analysis fails atomically on >200 source files, >1 MiB/file, >8 MiB captured source, >1,000 directories, >1,000 dependencies, >5,000 entries in any one directory, >32 path segments, or >10 seconds elapsed at cooperative checkpoints. Up to 256 KiB per ignore file retains the M1 limit. Unsupported non-source files count as skipped, making `partial` true; ignored files are not counted. No pagination is needed within the 200-node/1,000-edge response ceiling. Symlinks and special files are refused. The inherited filesystem check/open sequence still has local concurrent-replacement TOCTOU exposure and is not an OS sandbox. Source parsing runs synchronously on bounded captured input; the 10-second guard cannot interrupt one pathological parse mid-call. No network or LLM calls are made.

### ADR-019 — Bounded TypeScript/JavaScript AST graph in existing loopback API

Status: Implemented / awaiting independent M2 review. Date: 2026-10-25. The roadmap defines M2 parser/data, M3 rendering, M4 2D and M6 inspection separately. Select the existing pinned TypeScript compiler as the AST parser and a single in-memory graph tied to the M1 selection; avoid an added database, separate graph store or new UI. Alternatives: regex scanning (unsound for source syntax), full language-server/tsconfig resolution (broader than M2), persistent database (unneeded at current scale). Tradeoffs: deterministic minimal surface and offline behavior, but bounded scale, no persistence, and only conservative static relative resolution. The graph endpoint inherits the existing local Host/Origin gate and exposes no source bytes; malicious local processes and concurrent filesystem replacement remain outside its guarantee. Evidence: `apps/server/src/graph.test.ts`, `apps/server/src/graph.core.test.ts`, full workspace checks and real CIE-root trial in the M2 handoff. The M3/M4 approved dark editorial design is unchanged.

M2 review follow-up (2026-10-25): independent decision PASS WITH ISSUES; the targeted import-equals correction increments `analyzerVersion` from `m2-ts-1` to `m2-ts-2` while retaining graph schema version 1. `UNSUPPORTED_IMPORT_SYNTAX` is deterministic and marks coverage partial. Correction is implemented and awaits reviewer verification; this entry does not authorize M3 by itself.
