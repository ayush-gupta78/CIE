# CIE

AI Codebase Intelligence Engine is a local-first codebase explorer. Select a local repository to map every eligible regular file in an interactive 3D atlas or 2D directory-organized connectivity map. Verified connections appear only where a supported static analyzer can establish them; files without extractable relationships remain visible.

## Run locally

Prerequisites: Node.js 20.19+ and pnpm 10.34.8 (enable the pinned package manager with `corepack enable`). Verified on Node 24.19.0.

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm dev
```

Open http://127.0.0.1:5173/; the Fastify API listens at http://127.0.0.1:3001/. Both bind to `127.0.0.1`; Vite proxies `/api` to the server. Stop both with Ctrl-C. Ports 5173 and 3001 must be free. The interface loads while the API is offline and reports connectivity accurately.

From the cinematic Archive home, choose **Open Local Repository** (or Repository in the top navigation), enter an absolute local folder path such as `/path/to/your/project`, then choose **Open repository**. Browsers cannot provide a normal folder input's absolute local path, so this manual path explicitly authorizes the local server to browse that directory. A `.git` folder is not required. Expand folders, select a file for basic metadata, use Load more for large directories, Refresh to see disk changes, Change repository to select another root, or Close repository to deselect without deleting any files. Selection lives in this server process only and is lost on restart. **Continue Current Session** enters the atlas only when such a selection exists; no recent-project history is stored.

Open **3D atlas** or **2D Graph** from navigation, or switch with **3D Map** / **2D Graph** inside the graph workspace. If this repository has no published graph, choose **Analyze repository**; switching modes never starts analysis. Both modes share one graph, search query, file selection, searchable directory tree, evidence workbench, inspector and file detail. Search by filename or relative path (press `/` to focus search); identical basenames remain distinguishable by their full paths. Choose any eligible file in the tree or scene, including isolated and unsupported files, or follow an evidence-backed relationship. **Open file details** shows metadata and exact static declarations, not source bytes. The direction is referencing file → referenced file; selected outgoing links are gold and incoming links blue. Escape clears selection (or search focus).

In 3D, left-drag to orbit, right-drag/two fingers to pan, wheel/pinch to zoom; use directory focus, **Focus file**, **Fit view**, **Rotate view**, **Reset orientation** and **All labels**. In 2D, drag empty map space to pan, wheel/pinch or **Zoom in** / **Zoom out**, **Fit view** for all files, **Focus selected** / **Focus file** for a selected node, or the directory focus buttons in the tree to frame a folder. Long map labels may be abbreviated; full paths remain accessible in the keyboard-operable tree, SVG node names and inspector. Switching modes retains file/search/inspector state and each mode's viewport while the workspace stays open. The 2D map works without WebGL; if 3D fails, choose **Open 2D Graph**. Below 700px use **Files** and **Inspector** panel buttons and the mode-specific controls popover. Changing/refreshing a repository invalidates old graph and view state; after server restart reopen the repository. Re-analysis is explicit. Graph data is in server/browser memory, not persisted. Findings/Analysis (M5), source reading (M6), AI/Assistant (M7) and snapshot import remain unavailable.

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

All permitted regular files, including binary assets, documentation, hidden and extensionless files, receive stable path-ID nodes and actual metadata. Unsupported dependency formats remain visible with `unsupported` status; `partial`, `failed` and `skipped` distinguish incomplete parsing, failures and size/encoding limits. JS/JSX/TS/TSX/MJS/CJS/MTS/CTS retain TypeScript AST parsing for top-level static imports/reexports. Conservative additional adapters resolve exact unique local files for Python relative `from` imports, Java class imports in conventional source roots, quoted C/C++ includes, Rust `mod` declarations, HTML local references and CSS imports/asset URLs; their coverage is explicitly partial. Bare/external, unresolved and ambiguous constructs never form verified file edges. Graph schema v1 adds category, text/binary/unknown kind, size and resolved incoming/outgoing counts; `analyzerVersion` is `m3-universal-1`. An optional source SHA-256 is present only when bytes were captured; each verified edge cites captured source path/line/column/hash. Metadata-only files are not loaded for parsing. The analysis rejects more than 200 eligible files, 1,000 directories, 1,000 edges or 10 seconds at checkpoints rather than publishing a truncated graph. Parser input is capped at 1 MiB/file and 8 MiB total; oversized non-JS files remain visible with skipped-analysis status, while existing JS/TS limits reject reanalysis. No source-content endpoint, tsconfig-alias resolver, persistent snapshot, incremental index, or universal dependency parser exists. See ADR-025 for metadata-only manifest tradeoffs. The parser and scanner tests run in `pnpm test` (`apps/server/src/graph*.test.ts`).

The API restricts Host to `127.0.0.1:3001` or `127.0.0.1:5173`, and supplied Origin to the matching HTTP loopback origins. An absent Origin is allowed for CLI clients with an approved Host. No broad CORS. Root selection is deliberate and in-memory, a selected symlink root is refused, descendants are never followed through symlinks, and subsequent paths undergo lexical and canonical containment checks. The tree browser receives names, relative paths and metadata; the graph API additionally exposes import specifiers and fingerprints, never full source content or absolute root paths. This is not a sandbox against malicious local processes or a complete defense against filesystem TOCTOU replacement races.

Generated directories (`.git`, `node_modules`, `dist`, `build`, `coverage`, `.next`, `.turbo`, `.cache`) are always hidden. `.env*` is hidden by default, except `.env.example`. Root and nested `.gitignore` rules use the `ignore` library with negation; rules inside an ignored parent cannot make that parent browsable. Git index tracking, global excludes and `.git/info/exclude` are not consulted. Each directory is loaded lazily, capped at 5,000 scanned entries with a 200-entry maximum page and 256 KiB per ignore file; oversized directories/rules return a structured error rather than being partially represented. Refresh is manual, not a filesystem watcher. Filenames containing literal backslashes or percent escapes cannot be navigated as directory paths by this API. Windows/UNC path behavior has not been verified on Windows.

## Structure and scope

- `apps/web/`: React/Vite shell, repository tree, health and repository API clients, validated graph client, M3 Three.js spatial view and M4 WebGL-free SVG file map.
- `apps/server/`: Fastify HTTP gate, in-memory selection, bounded filesystem explorer and M2 static graph API.
- `ARCHITECTURE.md`: living data flow, trust boundaries, roadmap and append-only decisions.
- `docs/UI_DESIGN_SPEC.md`: current six-reference design decision plus historical guidance; `docs/screenshots/`: final browser captures and prior M3 evidence.

Archive, Repository, 3D atlas, 2D Graph and Settings navigation work. M0–M2 are owner-approved; M3 was temporarily owner-approved on October 27, 2026; M4 is implemented awaiting independent owner review. M5 advanced analysis, M6 source reading and M7 optional AI were not built. No signup, telemetry, external runtime API, code upload or account is required. The newer six-image visual handoff resides locally under ignored `prompts/m3-visual-redesign/references/`; implemented-app captures are in `docs/screenshots/`. The Home background is an original generated illustration bundled with the app rather than an approved screenshot used as a facade.
