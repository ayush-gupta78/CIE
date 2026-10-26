# CIE

AI Codebase Intelligence Engine is a local-first codebase explorer. Select a local repository, analyze supported TypeScript/JavaScript files, and explore their verified connections in a genuine interactive 3D atlas. The alternate 2D map remains M4.

## Run locally

Prerequisites: Node.js 20.19+ and pnpm 10.34.8 (enable the pinned package manager with `corepack enable`). Verified on Node 24.19.0.

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm dev
```

Open http://127.0.0.1:5173/; the Fastify API listens at http://127.0.0.1:3001/. Both bind to `127.0.0.1`; Vite proxies `/api` to the server. Stop both with Ctrl-C. Ports 5173 and 3001 must be free. The interface loads while the API is offline and reports connectivity accurately.

From the cinematic Archive home, choose **Open Local Repository** (or Repository in the top navigation), enter an absolute local folder path such as `/path/to/your/project`, then choose **Open repository**. Browsers cannot provide a normal folder input's absolute local path, so this manual path explicitly authorizes the local server to browse that directory. A `.git` folder is not required. Expand folders, select a file for basic metadata, use Load more for large directories, Refresh to see disk changes, Change repository to select another root, or Close repository to deselect without deleting any files. Selection lives in this server process only and is lost on restart. **Continue Current Session** enters the atlas only when such a selection exists; no recent-project history is stored.

Open **3D atlas** from the top navigation or **3D Map** in the atlas rail. If this repository has no published graph, choose **Analyze repository**; analysis is never started by merely opening the page. The live Three.js stage, nested explorer, four-pane lower workbench and inspector contain only actual M2 records. Search by filename or relative path (press `/` to focus search), expand directories using buttons/keyboard, choose a file from the tree or scene, or follow a verified relationship in the inspector or related-file list. Hover a marker or label for its full relative path; duplicate filenames use distinguishing paths. **Open file details** shows a parchment evidence view with real import/re-export specifiers, captured line/column, counts and parse status, but no source bytes. A selected file in Repository can link to the same detail if it occurs in the analyzed graph; otherwise the atlas reports that it is outside supported M2 analysis. Left-drag to orbit, right-drag or use two fingers to pan, wheel/pinch to zoom; use each directory focus button for a module, **Focus file** for a selected neighborhood, **Fit view** to fit without changing orientation, **Rotate view** for a keyboard-accessible 45° orbit, and **Reset orientation** for the initial angle. **All labels** increases candidate density but still culls collisions; the tree always exposes every file. Escape clears selection (or clears/defocuses search). Below 700px use **Files** and **Inspector** panel buttons and the **Atlas controls** popover. The visible 2D switch is disabled until M4; Findings/Analysis (M5), source reading (M6), AI/Assistant (M7) and snapshot import remain unavailable. If WebGL fails, the same actual tree/relationship lists remain usable. Switching/refreshing a repository invalidates its old graph; after a server restart, reopen a repository. Re-analysis is explicit. Graph data is in server/browser memory, not persisted.

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

M2 graph API (same Host/Origin gate): `POST /api/v1/repository/analyze` with JSON `{ "repositoryId": "<selection ID>", "revision": <selection revision> }` captures and analyzes the selected root; `GET /api/v1/repository/graph` returns the last graph for that selection or `NO_GRAPH` (409). Use the `repositoryId` and `revision` returned by selection or `GET /api/v1/repository`. For example, with the local API running, select a trusted directory and inspect JSON with:

```sh
curl --noproxy '*' -sS -H 'Host: 127.0.0.1:3001' -H 'Content-Type: application/json' -d '{"path":"/path/to/your/project"}' http://127.0.0.1:3001/api/v1/repository/select
# Put the returned repositoryId and revision into the next JSON body.
curl --noproxy '*' -sS -H 'Host: 127.0.0.1:3001' -H 'Content-Type: application/json' -d '{"repositoryId":"<ID>","revision":1}' http://127.0.0.1:3001/api/v1/repository/analyze
curl --noproxy '*' -sS -H 'Host: 127.0.0.1:3001' http://127.0.0.1:3001/api/v1/repository/graph
```

Supported syntax: UTF-8 JS/JSX/TS/TSX/MJS/CJS/MTS/CTS, parsed with TypeScript's AST without executing target code. Top-level static ES imports/reexports yield directed local edges only for unique relative file/index matches; bare packages are external, missing/ambiguous imports unresolved and dynamic expressions diagnostic-only. TypeScript import-equals declarations (including `import dep = require("./dep")`) emit `UNSUPPORTED_IMPORT_SYNTAX` at the declaration's source line, create no edge and set `partial: true`; graph schema stays v1 and `analyzerVersion` is `m2-ts-2`. Each file has a content SHA-256 and each edge cites captured source path/line/column/hash; no source-content endpoint exists, so verify hashes before using live source for citations. Graphs are bounded to 200 source files, 1 MiB per file, 8 MiB total, 1,000 dependencies, 1,000 directories and 10 seconds at cooperative checks. An over-limit run fails instead of publishing a partial graph. `partial` and `counts.skipped` expose unsupported files. There is no tsconfig-alias resolution, Python parser, persistent snapshot or incremental indexing. The full parser tests are included in `pnpm test` (`apps/server/src/graph*.test.ts`).

The API restricts Host to `127.0.0.1:3001` or `127.0.0.1:5173`, and supplied Origin to the matching HTTP loopback origins. An absent Origin is allowed for CLI clients with an approved Host. No broad CORS. Root selection is deliberate and in-memory, a selected symlink root is refused, descendants are never followed through symlinks, and subsequent paths undergo lexical and canonical containment checks. The tree browser receives names, relative paths and metadata; the graph API additionally exposes import specifiers and fingerprints, never full source content or absolute root paths. This is not a sandbox against malicious local processes or a complete defense against filesystem TOCTOU replacement races.

Generated directories (`.git`, `node_modules`, `dist`, `build`, `coverage`, `.next`, `.turbo`, `.cache`) are always hidden. `.env*` is hidden by default, except `.env.example`. Root and nested `.gitignore` rules use the `ignore` library with negation; rules inside an ignored parent cannot make that parent browsable. Git index tracking, global excludes and `.git/info/exclude` are not consulted. Each directory is loaded lazily, capped at 5,000 scanned entries with a 200-entry maximum page and 256 KiB per ignore file; oversized directories/rules return a structured error rather than being partially represented. Refresh is manual, not a filesystem watcher. Filenames containing literal backslashes or percent escapes cannot be navigated as directory paths by this API. Windows/UNC path behavior has not been verified on Windows.

## Structure and scope

- `apps/web/`: React/Vite shell, repository tree, health and repository API clients, validated M2 graph client and M3 Three.js spatial view.
- `apps/server/`: Fastify HTTP gate, in-memory selection, bounded filesystem explorer and M2 static graph API.
- `ARCHITECTURE.md`: living data flow, trust boundaries, roadmap and append-only decisions.
- `docs/UI_DESIGN_SPEC.md`: current six-reference design decision plus historical guidance; `docs/screenshots/`: final browser captures and prior M3 evidence.

Archive, Repository, 3D atlas and Settings navigation work. M0–M2 are owner-approved; the owner-verified M3 UI redesign is implemented **awaiting independent owner review**. M4 2D, M5 advanced analysis, M6 source inspection and M7 optional AI were not built. No signup, telemetry, external runtime API, code upload or account is required. The newer six-image visual handoff resides locally under ignored `prompts/m3-visual-redesign/references/`; implemented-app captures are in `docs/screenshots/ui-redesign-*.png`. The Home background is an original generated illustration bundled with the app rather than an approved screenshot used as a facade.
