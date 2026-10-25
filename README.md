# CIE

AI Codebase Intelligence Engine is a local-first codebase explorer. M1 lets you explicitly open a directory on this computer and browse real files and folders. It does not analyze dependencies or render a graph yet.

## Run locally

Prerequisites: Node.js 20.19+ and pnpm 10.34.8 (enable the pinned package manager with `corepack enable`). Verified on Node 24.19.0.

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm dev
```

Open http://127.0.0.1:5173/; the Fastify API listens at http://127.0.0.1:3001/. Both bind to `127.0.0.1`; Vite proxies `/api` to the server. Stop both with Ctrl-C. Ports 5173 and 3001 must be free. The interface loads while the API is offline and reports connectivity accurately.

Go to Repository, enter an absolute local folder path such as `/path/to/your/project`, then choose Open repository. Browsers cannot provide a normal folder input's absolute local path, so this manual path explicitly authorizes the local server to browse that directory. A `.git` folder is not required. Expand folders, select a file for basic metadata, use Load more for large directories, Refresh to see disk changes, Change repository to select another root, or Close repository to deselect without deleting any files. Selection lives in this server process only and is lost on restart.

```sh
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm format:check
```

The built server is `apps/server/dist/main.js`; the built static web app is `apps/web/dist/`. Production static hosting needs an equivalent same-origin `/api` proxy and its own security review; no hosted deployment is configured. `.github/workflows/ci.yml` runs these checks on GitHub push/PR for `main`; a local check does not establish remote CI success.

## API and security

`GET /api/v1/health` returns `{"status":"ok","mode":"local","version":"0.1.0"}`. Repository routes are:

- `GET /api/v1/repository`: current safe selection or `{ "selected": false }`.
- `POST /api/v1/repository/select`: JSON `{ "path": "/absolute/project/path" }` selects one directory; response includes only an opaque repository ID, revision and basename.
- `GET /api/v1/repository/tree?dir=.&repositoryId=<id>&revision=<n>&limit=100`: one level of real entries, directories first, with an opaque `nextCursor` for more pages. `dir` is `.` or a normalized repo-relative path. `limit` defaults to 100, maximum 200.
- `POST /api/v1/repository/rescan`: JSON `{}` advances revision; the UI reloads visible directory listings.
- `DELETE /api/v1/repository`: JSON `{}` clears selection, never touches disk.

State-changing requests require `Content-Type: application/json`. Expected errors use `{ "error": { "code": "INVALID_INPUT", "message": "..." } }` (also `FORBIDDEN_PATH`, `NOT_FOUND`, `STALE_REPOSITORY`, `NO_REPOSITORY_SELECTED`, `DIRECTORY_TOO_LARGE`, `IGNORE_TOO_LARGE`, `UNAVAILABLE`). The browser client requires matching repository ID/revision before accepting pages.

The API restricts Host to `127.0.0.1:3001` or `127.0.0.1:5173`, and supplied Origin to the matching HTTP loopback origins. An absent Origin is allowed for CLI clients with an approved Host. No broad CORS. Root selection is deliberate and in-memory, a selected symlink root is refused, descendants are never followed through symlinks, and subsequent paths undergo lexical and canonical containment checks. The browser receives names, relative paths and metadata, never source content or absolute root paths. This is not a sandbox against malicious local processes or a complete defense against filesystem TOCTOU replacement races.

Generated directories (`.git`, `node_modules`, `dist`, `build`, `coverage`, `.next`, `.turbo`, `.cache`) are always hidden. `.env*` is hidden by default, except `.env.example`. Root and nested `.gitignore` rules use the `ignore` library with negation; rules inside an ignored parent cannot make that parent browsable. Git index tracking, global excludes and `.git/info/exclude` are not consulted. Each directory is loaded lazily, capped at 5,000 scanned entries with a 200-entry maximum page and 256 KiB per ignore file; oversized directories/rules return a structured error rather than being partially represented. Refresh is manual, not a filesystem watcher. Filenames containing literal backslashes or percent escapes cannot be navigated as directory paths by this API. Windows/UNC path behavior has not been verified on Windows.

## Structure and scope

- `apps/web/`: React/Vite shell, responsive repository tree, health and repository API clients, design tokens.
- `apps/server/`: Fastify HTTP gate, in-memory selection and bounded filesystem explorer.
- `ARCHITECTURE.md`: living data flow, trust boundaries, roadmap and append-only decisions.
- `docs/UI_DESIGN_SPEC.md`: approved original design direction; `docs/screenshots/`: browser captures.

Workspace, Repository and Settings navigation work. The 3D/2D controls and Graph/Insights/AI navigation remain visibly disabled. M2 dependency extraction, M3 3D, M4 2D, M5 analysis, M6 source inspector and M7 optional AI were not built. No signup, telemetry, external runtime API, code upload or account is required.
