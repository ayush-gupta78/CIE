# CIE — Architecture and Project Context

> Living decision record. M0 implementation status and validation are described below.

- **Project:** AI Codebase Intelligence Engine (**CIE**, working label; no finalized product name)
- **Model:** local-first localhost web app. No hosted/Vercel runtime for local code analysis.
- **Stage:** M0 implemented; M1 not started.
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

## Non-goals for M0

File ingestion, Git clone, AST parsing, real graphs, Three.js/R3F scene, 2D graph layout, inspector real data, AI API integration, accounts, Vercel hosting, desktop installer. These are phased later.

## Architecture (M0 running path and planned extensions)

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

M0 status: `apps/web` renders an honest empty workspace and Settings; it checks `/api/v1/health` on entry, every 30 seconds and on manual retry. Vite proxies `/api` to the Fastify loopback server during development. A malformed response, failed request or 5-second timeout displays disconnected; no saved repository or graph state exists. Both dev servers bind `127.0.0.1`. The only API route is `GET /api/v1/health` returning exactly `{ "status": "ok", "mode": "local", "version": "0.1.0" }`. The frontend does not require the API to render.

## Code boundaries

- `apps/web`: React+TypeScript view/state, responsive shell; no direct Node FS or secret persistence.
- `apps/server`: localhost-only HTTP API, validation, future repository read/indexing boundary.
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
- Future file access endpoints require rigorous path boundaries, canonicalization and symlink handling, strict input validation, and explicit selections; never expose arbitrary paths on a wildcard bind.
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

| Milestone | Scope                                                                            | Gate                                                              |
| --------- | -------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| **M0**    | Monorepo/tooling, local API, design system, polished empty-state app shell, docs | install/dev/build/typecheck/lint/tests run; truthful local status |
| **M1**    | local repository ingestion, directory tree, ignore handling                      | browse a real local repo                                          |
| **M2**    | import/relationship parser and graph model                                       | explainable nodes & edges                                         |
| **M3**    | interactive 3D file graph, camera and labels                                     | browse real dependencies in spatial depth                         |
| **M4**    | alternate 2D graph and synchronized navigation                                   | both modes operate on same graph                                  |
| **M5**    | non-LLM code intelligence                                                        | dependency metrics, impact and cycles                             |
| **M6**    | file inspector and source references                                             | accurate source/detail navigation                                 |
| **M7**    | optional LLM adapter/retrieval                                                   | explicit opt-in, grounded explanations                            |
| **M8**    | performance, security hardening, DX                                              | realistic repo scale and robust failures                          |
| **M9**    | tests, docs, distribution/release                                                | runnable tested v1.0                                              |

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

## Open decisions (not blockers to M0)

- Final product name/brand identity beyond working label `CIE`.
- Exact screenshots of preferred final UI can further refine token values and component shapes; explicit user corrections take priority.
- M1 folder permission flow and ignored file policy.
- M2 parser/language support order and exact graph schema.
- M3 graph layout and rendering-performance strategy.
- M7 choice of external vs local LLM providers and opt-in details.

## Document maintenance protocol

1. Before any significant change, read this file.
2. Append a dated ADR with alternatives considered and impact; update diagrams, stack, roadmap and actual status.
3. If changing UI direction, update `UI_DESIGN_SPEC.md` and log supersession. If changing executable commands, update README and checklist.
4. After each milestone, record validated tests, known issues, and deferred scope. **Never declare an unimplemented milestone complete.**
