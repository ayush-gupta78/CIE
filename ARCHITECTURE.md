# CIE — Architecture and Project Context

> Living decision record. M0–M3 history and current M4 implementation are described below.

- **Project:** AI Codebase Intelligence Engine (**CIE**, working label; no finalized product name)
- **Model:** local-first localhost web app. No hosted/Vercel runtime for local code analysis.
- **Stage:** M0–M2 owner-approved; M3 temporarily owner-approved on 2026-10-27; M4 implemented, awaiting independent owner review.
- **Design source:** https://chatgpt.com/share/6addfe15-6604-83ee-865a-89701c1623fd
- **Primary UI spec:** [`docs/UI_DESIGN_SPEC.md`](docs/UI_DESIGN_SPEC.md)
- **Current date for decision log:** 2026-10-26

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

- `apps/web`: React+TypeScript view/state, responsive shell and M3 graph renderer; no direct Node FS or secret persistence.
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

The following bullets record the prior visual contract. **ADR-022 (2026-10-26) supersedes their blanket ban on human silhouettes and monumental/painterly architecture for the decorative Home background only**, following the owner's newer six-image approval. The graph still consists solely of real files and verified edges. The CIE working name and local-first/security requirements remain in force.

- **Old** Elden Ring influence is superseded by **original Expedition 33-inspired** painterly/editorial treatment.
- Dark/near-black base and restrained metallic accents; readable warm neutrals, not a gold-filled fantasy theme.
- No characters, kingdoms, castles or false fantasy world scene; code structure _is_ the view.
- Real 3D spatial graph and named file-to-file connections in M3; meaningful hierarchy; eventual 2D mode.
- **Do not call the product “Cinder Archive.”** `CIE` is temporary neutral working name.
- M0 shows true empty states, with future controls clearly deferred. See UI spec.

## Milestones and deliverables

| Milestone | Scope                                                                               | Gate                                                              |
| --------- | ----------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| **M0**    | Monorepo/tooling, local API, design system, polished empty-state app shell, docs    | install/dev/build/typecheck/lint/tests run; truthful local status |
| **M1**    | local repository ingestion, directory tree, ignore handling                         | browse a real local repo                                          |
| **M2**    | import/relationship parser and graph model — owner-approved                         | explainable nodes & edges; tests and real-repo trial below        |
| **M3**    | interactive 3D file graph, camera and labels — temporarily owner-approved           | browse real dependencies in spatial depth                         |
| **M4**    | alternate 2D graph and synchronized navigation — implemented, awaiting owner review | both modes operate on same graph                                  |
| **M5**    | non-LLM code intelligence                                                           | dependency metrics, impact and cycles                             |
| **M6**    | file inspector and source references                                                | accurate source/detail navigation                                 |
| **M7**    | optional LLM adapter/retrieval                                                      | explicit opt-in, grounded explanations                            |
| **M8**    | performance, security hardening, DX                                                 | realistic repo scale and robust failures                          |
| **M9**    | tests, docs, distribution/release                                                   | runnable tested v1.0                                              |

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
- M3 renderer and layout are recorded in ADR-020; large-repository tuning remains open.
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

Owner transition (2026-10-26): the owner explicitly approved M2 after the correction and authorized M3. Earlier review-status entries remain as historical records.

## M3 interactive 3D graph — implemented for independent review

`apps/web/src/graphApi.ts` validates the existing M2 schema v1 and selection/revision identity before accepting either `GET /api/v1/repository/graph` or explicit `POST /api/v1/repository/analyze`. `GraphPage.tsx` owns one graph snapshot, selection, search and camera commands, and keeps a previous graph only after failed re-analysis of the same revision. Switching repository/revision clears selection and graph; aborted/outdated responses cannot publish stale nodes. Health polling does not clear a current graph. The Graph page is lazy-loaded, leaving the original Workspace, Repository tree, Settings, local connection status and Fastify routes intact.

`graphModel.ts` projects only `resolved_static` edges with real targets; direction is importer → imported file. Parallel declarations are merged only for visual lines and retained individually for the inspector. Groups come from real parent paths, including flat `.`; their colors and file positions are deterministic. A sorted three-level layout places leaf folders near second-segment modules within major root-folder clusters, separated on x/y/z; deeper paths share their module cluster. Directory labels and small markers annotate the hierarchy, not enclosing shells or dependency-bearing file nodes. A bounded enclosing radius and viewport-aspect-aware home camera provide fit/reset. A selected file highlights outgoing gold and incoming blue arrows, while the inspector exposes the actual source-path/line evidence, type, status and neighbors. No source content, symbol search, impact metrics or external target nodes are inferred.

`GraphScene3D.tsx` mounts Three.js 0.186.1 + `@react-three/fiber` 9.8.2 with `@react-three/drei` 10.7.9 for HTML labels and lines; `@types/three` 0.186.0 is a build-time type dependency. The perspective WebGL scene uses OrbitControls (left-drag orbit, right-drag/two-finger pan, wheel/pinch zoom), node picking, focus, fit and reset. It renders on demand with capped DPR 1.5, no idle particle animation or remote assets. Default labels are capped/keyed by group and selection; the file tree and inspector remain a keyboard-accessible alternative. Failed/unavailable WebGL exposes the same actual file and relation list, not the M4 2D map. Reduced motion uses the existing OS-media CSS policy and no continuous animation. M4's 2D affordance remains disabled.

Historical note: the original M3 handoff only contained a text crosswalk. The later ignored M3 correction pack contains the seven actual PNGs and the interactive prototype; the correction below uses the originals. The first M3 UI was implemented but not owner-approved.

### ADR-020 — Demand-rendered Three/R3F scene with deterministic path clusters

Status: Implemented / awaiting independent M3 review. Date: 2026-10-26. The M2 graph v1 is already the factual source, so the renderer consumes it without server or parser changes. Chosen: Three.js/R3F scene with OrbitControls, limited HTML labels, and a pure deterministic path-root/module/leaf layout; React local state owns selection and separate fetch/analysis request lifecycles. Alternatives: CSS-transformed SVG (not genuine 3D), raw WebGL/custom camera (more code and maintenance), full force-layout framework (nondeterminism and unnecessary runtime cost). Costs: WebGL and rendering libraries increase the lazy-loaded graph bundle; labels/line meshes can crowd small or maximum-size graphs. Mitigations: demand rendering, label cap, 200-file M2 ceiling, accessible tree/inspector fallback, no target-code execution or remote calls. M3 approval and performance at M2's upper limit still require independent review.

### ADR-021 — Corrected M3 spatial workspace and recoverable selection

Status: Implemented / awaiting independent owner review. Date: 2026-10-26. Retain the M2 graph-v1 snapshot and the demand-rendered Three/R3F perspective scene (ADR-020), replacing sphere scatter with file-ID-bound lit extrusions and low-opacity directory plinths, restrained gold/blue/mint module colors and a darker three-region workspace. Deterministic root/module/leaf positions now vary on all axes; different second-level modules such as `apps/server` and `apps/web` have separate coordinates and hues. Native OrbitControls supplies orbit, pan and zoom; an accessible Rotate view button advances the camera by 45°, Fit preserves orientation and fits bounds, Reset restores a slightly closer elevated composition on wide stages (full bounds on narrow stages), and explicit file/module focus keeps the current viewing direction. A projected-screen collision pass gives selected and direct-neighbor filenames priority; directory captions yield while tracing a selected file to avoid collisions, and full relative paths remain available through hover, the nested tree and inspector. The label-density control still culls overlaps rather than promising all 200 names at once. The mobile layout exposes the same tree and inspector through keyboard/touch-operable panel controls, while no-WebGL keeps both data panels. State is keyed to repository ID/revision; stale API errors, server reconnect and window focus re-check the selected repository, and latest-wins selection refresh prevents late reads from replacing a newer choice. Alternative of raster/prototype Canvas 2D rejected: neither supports genuine picking/depth nor graph-v1 truth. Costs: HTML labels and per-connection line draw calls can still be expensive near 200 files/1,000 declarations; no measured FPS guarantee yet. The source/AI/2D surfaces pictured in the reference images remain M4–M7, not this correction. Backend Host/Origin, path and parser boundaries are unchanged.

### ADR-022 — Owner-verified cinematic atlas and truthful investigation surfaces

Status: Implemented, **awaiting independent owner visual review**. Date: 2026-10-26. The owner rejected ADR-021's visual finish and provided a newer six-image reference set under local ignored `prompts/m3-visual-redesign/references/`. Image 05 is the primary M3 atlas target, 02 the Home, 01 the file-detail composition, 03 the future Assistant/Analysis language, 04 the graph interaction baseline and 06 the future M4 2D target. This decision overrides older broad bans on painterly arches and a small figure **as incidental decorative Home art only**; it does not permit unrelated fantasy objects in the graph or invented repository data. Contradictory screenshot wordmarks are not a name decision: keep CIE pending owner branding confirmation.

Chosen: preserve the validated M2 graph-v1 API and lazy demand-rendered Three/R3F renderer. `App.tsx`/`Workspace.tsx` expose real selection and navigation above a locally bundled original AI-generated decorative archive-hall illustration (`apps/web/public/art/archive-hall.webp`); `Crest.tsx` supplies inline SVG identity/nav marks. `atlas.css` layers the near-black/brass system over the historical CSS; dark glass atlas, four-pane lower investigation dock and responsive controls share one `GraphPage.tsx` selection. `GraphWorkbench.tsx` shows real M2 declaration evidence and a one-hop related-file list rather than a fake source editor or M4 minimap. `FileDetail.tsx` uses parchment panels with real path, language, parse status and directional import/re-export evidence; the repository metadata inspector links into that view if the selected file occurs in the analyzed graph, otherwise the atlas explains the unsupported/no-analysis state. The tree expands the densest real directory branch by default and remains searchable/keyboard-accessible. Prismatic file-ID-bound nodes add faceted wire outlines and luminous cores; module colors are derived from actual directory names with deterministic fallback. Camera bounds include column tops, Fit keeps full-graph context, Reset chooses a closer wide-stage view, and file/module focus remains real 3D. Selected and neighbor labels retain collision priority, while all paths remain in tree/inspector even without WebGL.

Recovery correction: `useLocalHealth` transitions through `checking` between `disconnected` and `connected`, so a direct-state comparison previously failed to revalidate a restarted backend's in-memory selection. `App.tsx` now latches a disconnect through the intermediate state, re-reads the selected root on reconnect and clears the stale graph/file state when the API returns no selection. The server contract and local trust boundary are unchanged; `App.test.tsx` covers the exact disconnected → checking → connected sequence.

Alternatives rejected: retain a simple dark-gold reskin (fails the approved layout), paste a screenshot into the stage (false/unusable), replace Three.js with a fake 2D perspective (loses M3), display example code/AI/minimap/recent projects (unsupported). The archive illustration contains no baked UI/text, is decorative, and makes no runtime network request. No CDN, telemetry, source upload, server route or API security boundary changed. M4 full 2D, M5 metrics, M6 source bytes and M7 AI remain explicitly unavailable. Cost: per-file prism/outline meshes and HTML labels may degrade on the M2 200-file ceiling; demand rendering, capped DPR, collision culling and the fallback tree mitigate but real-GPU performance still needs measurement. A live graph with only a few real files intentionally looks sparser than the illustrative city of towers in 05; do not fill it with fiction. Visual QA, final screenshots and test results belong to the owner review evidence, not an owner-approval claim.

### ADR-023 — Spatial fidelity correction without synthetic graph density

Status: Implemented, **awaiting independent owner visual review**. Date: 2026-10-26. ADR-022 remains the visual authority, with approved image 05 the primary target; its initial atlas left actual modules too compact and the 768px camera controls obscured the scene. Chosen: widen and depth-stagger the deterministic five-column file lattice, spread small numbers of actual directory modules across the stage, and position a lone root-level file between them. More than four module groups retain compact spacing so the M2 200-file ceiling stays bounded. Each file ID still owns exactly one pickable marker; its dark translucent body, wire edges, metallic cap and luminous core have decorative height variation, not a metric. Only graph-v1 verified importer → referenced-file edges become sixteen-segment lifted arcs and tangent direction markers. Selection illuminates the one real node and its actual outgoing gold/incoming blue paths while unrelated paths dim; no visual strand implies an unresolved or external dependency.

The home view now faces the directory spread more directly and uses a closer wide-stage frame; medium-width and portrait stages progressively widen the fit. Fit recomputes perspective bounds for the current orbit direction (including the polar view), Reset restores the authored perspective, focus remains file/module-based, and a resize across framing thresholds preserves orbit direction while recentering the real graph. At ≤1200px the controls become an operable popover and the redundant on-stage selected card yields to the persistent lower inspector; at ≤700px Files and Inspector remain accessible through tabs. Native OrbitControls, label collision priority, keyboard tree, touch gestures, reduced-motion support and the WebGL data fallback remain. CSS adds subdued violet/teal atmospheric light and refined Home/dock/parchment materials without overlaying graph content or using a static image. No bloom, transmission pass, idle animation, new dependency, external request, backend route or security change was introduced. The extra arc segments and per-file surfaces can affect large graphs; demand rendering, bounded M2 analysis and capped DPR remain the mitigations, not a claim of measured physical-GPU throughput. M4–M7 are unchanged and M4 has not started.

Verification at the M2 ceiling exposed clipping from the closer overview frame, so repositories above 80 files or four directory zones use full-bounds Reset instead. Focus includes marker tops and the current orbit direction; narrow-screen label margins shrink only enough to keep a selected filename visible without placing clipped chips at the stage edge. The 80-file cutover is deliberately conservative until actual GPU occupancy measurements justify a more adaptive frame.

### ADR-024 — Image 05 architectural reconstruction of factual M3 graph

Status: Implemented, **awaiting independent owner visual review**. Date: 2026-10-27. Image 05 remains the final M3 visual authority; ADR-022/023 are retained as history, not approval of their sparse geometry. Keep the M2 graph-v1 selection/revision contract and `projectGraph`'s resolved-static importer → referenced-file projection unchanged. One file ID owns one selectable scene group: its shared-unit-box meshes form a dark glass tower with metallic plinth, core, facade bays, four framed levels, ribs, setback crown, lit cap and deterministic silhouette variation. None of those meshes is a graph node or metric. An actual parent directory gets a bounded layered platform and real path caption; flat files remain in `.`. The five-wide deterministic lattice now places files across platform X/Z with shallow stepped Y instead of vertically scattering isolated columns. Existing root/module ancestry keeps actual siblings together, while reduced inter-module spacing improves occupancy. No illustrative directory, file or edge is added.

Each merged visual connection retains its M2 declaration list and exact directed endpoints. A lifted spline starts/ends at real file crowns; a soft halo, core and tangent-aligned cone are rendering layers of that same relationship, not additional semantic edges. Cross-directory connections receive stronger default emphasis; selection dims unrelated paths and highlights outgoing amber, incoming blue and the matching real endpoint structures. Camera Fit includes the tallest crowns and follows current orbit direction; Reset uses a three-quarter view with a slightly right-shifted target for the stage's left-side legend, reverting to full bounds above 80 files/four zones. Focus includes real neighbor crowns. Native OrbitControls, keyboard/tree alternative, touch and WebGL fallback are unchanged.

Shared box geometry and stable glass/metal materials avoid per-beam allocations; group-color accent materials are reused and disposed on model change. Demand rendering, capped DPR and two-level ornament detail (reduced above 80 files) bound work without pretending to guarantee GPU throughput. Tradeoffs: the number of beams and HTML labels still grows with actual files; no bloom pass, fabricated sky objects or decorative lines posing as dependencies were added. A repository with only two major actual modules remains visibly less populated than the illustration, and the direction of intra-district arcs is easiest to see when a file is selected. The owner must judge residual visual fidelity; this does not authorize M4.

### ADR-025 — Universal bounded file inventory and conservative relationship adapters

Status: Implemented for independent verification; M3 visual review remains open. Date: 2026-10-27. The prior M2 scanner discarded all non-JS/TS files, making documentation, assets and non-JS code invisible in the atlas. Keep the selected-root, `.gitignore`, generated/secret exclusions, path containment, symlink refusal, Host/Origin gate and atomic graph publication. Discover every permitted regular file without an extension allowlist, including hidden and extensionless files. Reject an analysis over 200 eligible files, 1,000 directories or 5,000 entries per directory instead of silently truncating; ignored files are outside scope, not unsupported. A regular file becomes one stable path-ID node even if its dependency format is unknown. Metadata-only nodes retain path, parent, actual size, category, language hint, text/binary/unknown classification and explicit `unsupported` status. Known binary/media files and large unknown files are not loaded merely for registration. Files selected for conservative parsing retain the existing 1 MiB/file, 8 MiB captured-text and 1,000-edge limits; oversized non-JS adapters are represented with `skipped` status and a diagnostic, while the pre-existing strict JS/TS analysis limit still rejects the whole reanalysis. The manifest uses captured-content hashes when available and path/size/mtime for metadata-only files; a same-size, same-mtime binary replacement cannot be detected by this lightweight inventory. Concurrent replacement remains outside an OS sandbox.

Graph schema version 1 is additively extended with `category`, `contentKind`, `sizeBytes`, exact resolved incoming/outgoing counts, optional `sha256` for metadata-only nodes, and `partial`/`unsupported`/`skipped` statuses; analyzerVersion advances to `m3-universal-1`. Old graph consumers may ignore extra fields, but a new analysis replaces the server's in-memory graph. TypeScript AST imports/re-exports retain their M2 extraction and evidence rule, with source targets still restricted to supported JS/TS files. Format-specific adapters resolve only exact, unique local files: Python relative `from` modules, Java exact class imports in conventional source roots, quoted C/C++ includes, Rust `mod` declarations, HTML local script/style/image links and CSS imports/asset URLs. These non-AST adapters are deliberately reported `partial`: they do not claim complete syntax coverage. Bare/external, unresolved and ambiguous references never create a resolved edge. Go, JVM variants beyond the exact Java subset, other languages, arbitrary config references, media and unknown formats remain metadata-visible with unsupported dependency analysis. No parser executes repository code or serves source bytes. A category-color facade marker differentiates real file types without adding selectable graph identities. Search, tree, inspector and detail show metadata and coverage status for disconnected files; M4–M7 remain deferred.

CI correction: the initial Image 05 push failed only in `App.test.tsx` while the lazy graph module was still displaying its Suspense fallback on the slower Node 22 runner. The precise heading assertion and real navigation remain; its targeted async wait accommodates a cold transform without disabling tests or changing production routing. All local CI-equivalent checks pass on Node 22 after the correction. Remote CI for this uncommitted change is not claimed.

## M4 alternate 2D map — implementation handoff (2026-10-27)

The owner temporarily approved M3 and authorized M4 on October 27, 2026. This transition does not retroactively change the historical M3 review records above. M4 extends the same GraphPage graph snapshot and canonical file ID: `projectGraph` filters only resolved, directed, evidence-bearing relationships, while `graphLayout2D.ts` recursively places every file under its actual directory ancestry. Empty intermediate directories are visual containers, not dependency endpoints. Two deterministic columns of top-level directories contain vertically stacked nested regions and stable filename grids (up to three columns per directory). Fit bounds include all directories and isolated files; empty and single-file snapshots have finite geometry. The SVG renderer `GraphScene2D.tsx` draws actual file nodes and directional arrowheads, dimming unrelated paths on selection while emphasizing outgoing gold/incoming blue. Exact declarations remain in the unchanged workbench, inspector and file detail. No server route, scanner or schema change was needed.

`App.tsx` owns the active 3D/2D mode and keeps the GraphPage mounted while switching modes. GraphPage continues to own the one graph fetch/explicit analysis lifecycle, search and selected file; both scene components receive the same projection. The 3D scene remains mounted but visually and interactively hidden after first visit, retaining its orbit; the 2D scene retains independent pan/zoom between switches. Repository ID/revision remounts GraphPage, clearing both viewports and selection. Successful same-revision reanalysis clears selection and refits 2D; failed reanalysis retains the previous snapshot. The existing generation/abort checks and reconnect revalidation prevent late old-repository responses from publishing. Opening 2D first does not create a WebGL canvas; unavailable WebGL offers a direct 2D switch.

SVG file nodes have keyboard-operable targets with full path names and focus styling; tree search, directory focus, inspector and mobile panel tabs remain available. Pointer pan, anchored wheel/pinch zoom, buttons, fit and selected-centered one-hop neighborhood focus use bounded scale and ResizeObserver. The complete 200-file inventory may fit too small to read all scene labels at once; zoom/focus or the always-present searchable tree exposes full paths. Deep directories make wide nested boxes and long filenames are truncated on the map only, with exact paths in accessible names/tree/inspector. SVG's per-file/per-connection DOM scales to the current 200-file/1,000-declaration analysis ceiling, not an unlimited repository. No FPS claim is made. The 2D grouping is a directory-organized map rather than the reference image's illustrative force bubbles; this avoids overlapping labels and artificial connectivity.

Known separate parser issue: a commented-out C/C++ `#include` may match an existing file and yield a false-positive edge. This requires a targeted parser correction and regression test outside M4; the 2D renderer displays exactly the validated backend graph and cannot adjudicate a parser's erroneous evidence. M5–M7 remain unimplemented. Local checks and browser evidence belong to this handoff, not independent owner approval or remote CI.

### ADR-026 — Independent SVG file map sharing the M3 graph workspace

Status: Implemented, awaiting independent owner review. Date: 2026-10-27. Choose a pure deterministic nested-directory SVG layout and native pointer/keyboard interaction over flattening the Three camera, a force-directed library or another graph service. One graph-v1 response and one GraphPage selection/search/inspector serve both modes; App only controls which visualization is active. Keep 3D mounted after first visit for orbit persistence; preserve 2D viewport in component state. Benefits: WebGL-free 2D, testable stable layout, exact file identities and directed evidence, accessible tree fallback. Costs: long directory trees yield a tall fit with small labels and parallel paths can overlap; zoom/focus and the inspector provide legibility. No synthetic edges, external dependencies or API boundary changes.

## M4 owner-directed correction — circular connectivity constellation (2026-10-27)

The owner rejected M4's rectangular directory-panel view. The M4 graph now uses a deterministic 2D node-link constellation: `graphLayout2D.ts` sorts real file groups and verified connections, packs path-derived group anchors, initializes each file on a stable golden-angle spiral, then runs bounded repulsion, verified-edge attraction, directory pull and collision separation. Its longest axis is aligned with the wide stage. The simulation finishes before rendering; selection, hover, pan, search and zoom do not recalculate geometry. All eligible files, including metadata-only and disconnected files, have positions and finite fit bounds. Directory captions/color identify real parent paths without containment boxes or fictitious edges. The 200-file/1,000-declaration server limits bound the O(iterations × files²) layout; there is no force library or runtime animation.

`GraphScene2D.tsx` renders small circular file markers with separate transparent hit regions, hollow unsupported nodes and selected gold/ivory emphasis. Directed lines use only `projectGraph`'s verified resolved references, stop short of the target circle and offset reciprocal paths. Selection preserves the shared canonical file ID, highlights gold outgoing and blue incoming connections and their actual neighbors, dims unrelated graph elements, and leaves exact declaration evidence in the existing inspector. Filename labels are collision-limited and zoom-dependent; selected paths and hover/status/count context use clamped, readable overlays, while search marks matching IDs and the tree retains full paths. Background clicks retain selection; Esc or Clear selection clears it. A pointer gesture belongs to its own captured pointer(s), has a movement threshold and is reset on up/cancel, so a subsequent node click is not swallowed. Touch pinch, anchored wheel zoom, fit, file-neighborhood focus and directory-file focus remain bounded and WebGL-free. The 3D renderer and shared fetch/analysis lifecycle remain separate from the 2D viewport.

The 3D `CameraRig` resize correction preserves orbit direction and the deliberate target while recalculating the required distance from current focused bounds on material aspect changes. Small resizes do not reset orientation; Fit still provides a full graph frame. In the C/C++ adapter, comment/string masking and conservative conditional tracking prevent commented or provably inactive `#include` lines from becoming verified edges. Macro-dependent conditions are not evaluated: they produce `UNSUPPORTED_PREPROCESSOR_CONDITION` diagnostics, suppress uncertain edges and retain partial coverage. Captured source line evidence remains stable. Graph schema stays v1; changed extraction semantics advance `analyzerVersion` from `m3-universal-1` to `m3-universal-2`. No compiler execution, new endpoint, trust-boundary change, telemetry or external service was added.

Tradeoffs: dense fitted graphs show circles and limited cluster captions rather than every filename; use search, zoom, focus or the keyboard-operable tree for exact paths. Dense verified edges can still cross, and hit areas shrink with a fit of the 200-file ceiling. Tests and local browser evidence do not imply physical-device touch or hardware GPU performance. M4 remains corrected and awaiting independent owner review; M5–M7 are not started.

### ADR-027 — Supersede the rectangular M4 layout with a factual circular constellation

Status: Implemented, awaiting independent owner review. Date: 2026-10-27. ADR-026 remains the historical first M4 implementation, but its rectangular file/directory geometry is superseded. Choose a bounded deterministic path-aware relaxation and SVG circles over a continuous force simulation, a new visualization dependency or a flattened 3D camera. Keep one backend graph and one selected file/search state, preserve M3's separate orbit, and use explicit analysis rather than mode-triggered fetches. The correction also fixes gesture lifecycle, selected-neighborhood framing, 3D resize and conservative C/C++ include evidence. Costs are a synchronous bounded layout on graph changes and intentionally sparse labels at overview scale; exact evidence and complete paths remain available in the inspector/tree.
