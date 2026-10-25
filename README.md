# CIE

AI Codebase Intelligence Engine is a local-first codebase explorer. Milestone M0 is a working application shell and local health API, not a repository analyzer.

## Run locally

Prerequisites: Node.js 20.19+ and pnpm 10.34.8 (Corepack can supply the pinned version: `corepack enable`). Verified on Node 24.19.0.

```sh
pnpm install --frozen-lockfile
pnpm dev
```

Open http://127.0.0.1:5173/ . The API listens at http://127.0.0.1:3001/api/v1/health . Stop both with Ctrl-C. Ports 5173 and 3001 must be free. Both bind loopback only; Vite proxies `/api` to the API on the same machine. The web shell still renders when the API is unavailable; it displays Disconnected and offers Retry connection.

```sh
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm format:check
```

All listed checks were run for M0. To run the built API: `node apps/server/dist/main.js`; the static web output is `apps/web/dist/` and requires a same-origin `/api` reverse proxy to communicate with the local server. The documented development command supplies that proxy.

## Project tour

- `apps/web/`: React, TypeScript and Vite shell; CSS variables in `src/tokens.css`, responsive layout in `src/styles.css`.
- `apps/server/`: Fastify loopback API. Its only route is `GET /api/v1/health`, returning `{ "status": "ok", "mode": "local", "version": "0.1.0" }`.
- `ARCHITECTURE.md`: data flow, trust boundaries, milestone roadmap and append-only decision log.
- `docs/UI_DESIGN_SPEC.md`: approved original visual direction; `docs/screenshots/`: M0 browser captures.

## Scope and privacy

Workspace and Settings navigation, local API status/retry and the honest empty graph stage work. Settings reports version, local privacy and system-managed reduced motion. Repository import (M1), dependency extraction (M2), 3D/2D views (M3/M4), analytics (M5), file detail data (M6), and opt-in AI (M7) are not implemented. Future controls show their milestone and are disabled.

No signup, telemetry, uploaded code, LLM provider or external runtime API is used. No files are read by the server in M0. The API now rejects unapproved Host/Origin headers and non-JSON mutations ahead of M1 filesystem access; the browser uses the same-origin Vite proxy. Loopback and these gates do not sandbox against malicious local processes. Before any future filesystem API, add canonical path and symlink validation and explicit permission boundaries.
