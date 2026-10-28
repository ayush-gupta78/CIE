import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { useLocalHealth } from "./useLocalHealth";
import { Workspace } from "./Workspace";
import { Settings } from "./Settings";
import { RepositoryPage } from "./RepositoryPage";
import { Crest, NavGlyph } from "./Crest";
import { FindingsPage } from "./FindingsPage";

import { currentRepository, type Entry, type Selection } from "./repositoryApi";

type Page = "workspace" | "repository" | "graph" | "findings" | "settings";
const GraphPage = lazy(() =>
  import("./GraphPage").then((module) => ({ default: module.GraphPage })),
);

export function App() {
  const [page, setPage] = useState<Page>("workspace");
  const [graphMode, setGraphMode] = useState<"3d" | "2d">("3d");
  const { connection, version, check } = useLocalHealth();
  const [repository, setRepository] = useState<Selection | null | undefined>(
    undefined,
  );
  const [selectedFile, setSelectedFile] = useState<Entry | null>(null);
  const [initialFilePath, setInitialFilePath] = useState<string | null>(null);
  const [initialManifest, setInitialManifest] = useState<string | null>(null);
  const [initialEdgeId, setInitialEdgeId] = useState<string | null>(null);
  const [startupError, setStartupError] = useState("");
  const mustRevalidateSelection = useRef(false);
  const selectionGeneration = useRef(0);
  const loadSelection = useCallback(async (signal: AbortSignal) => {
    const current = ++selectionGeneration.current;
    try {
      const result = await currentRepository(signal);
      if (!signal.aborted && selectionGeneration.current === current) {
        setRepository(result);
        setSelectedFile(null);
        setInitialFilePath(null);
        setInitialManifest(null);
        setStartupError("");
        setInitialEdgeId(null);
      }
    } catch (error) {
      if (!signal.aborted && selectionGeneration.current === current)
        setStartupError(
          error instanceof Error ? error.message : "Local API unavailable.",
        );
    }
  }, []);
  useEffect(() => {
    if (connection !== "connected" || repository !== undefined) return;
    const controller = new AbortController();
    void loadSelection(controller.signal);
    return () => controller.abort();
  }, [connection, repository, loadSelection]);
  useEffect(() => {
    if (connection === "disconnected") mustRevalidateSelection.current = true;
    if (connection === "connected" && mustRevalidateSelection.current) {
      // Health checks pass through "checking"; preserve the disconnect across it.
      mustRevalidateSelection.current = false;
      setRepository(undefined);
    }
  }, [connection]);
  useEffect(() => {
    if (connection !== "connected") return;
    const controller = new AbortController();
    const verify = () => {
      if (document.visibilityState === "visible")
        void loadSelection(controller.signal);
    };
    window.addEventListener("focus", verify);
    return () => {
      controller.abort();
      window.removeEventListener("focus", verify);
    };
  }, [connection, loadSelection]);
  const onChange = (next: Selection | null) => {
    selectionGeneration.current++;
    setRepository(next);
    setSelectedFile(null);
    setInitialFilePath(null);
    setInitialManifest(null);
    setStartupError("");
    setInitialEdgeId(null);
  };
  const onStale = useCallback(() => {
    selectionGeneration.current++;
    setRepository(undefined);
    setSelectedFile(null);
    setInitialFilePath(null);
    setInitialManifest(null);
    setInitialEdgeId(null);
  }, []);

  const statusText =
    connection === "connected"
      ? "Connected"
      : connection === "checking"
        ? "Checking"
        : "Disconnected";

  return (
    <div className={`shell page-${page}`}>
      <header className="topbar">
        <div
          className="brand"
          aria-label="CIE, AI Codebase Intelligence Engine"
        >
          <Crest className="brand-crest" />
          <span className="brand-wordmark">
            CIE<small>Codebase intelligence</small>
          </span>
        </div>
        <nav className="top-navigation" aria-label="Archive navigation">
          <button
            type="button"
            aria-current={page === "workspace" ? "page" : undefined}
            onClick={() => setPage("workspace")}
          >
            Archive
          </button>
          <button
            type="button"
            aria-current={page === "repository" ? "page" : undefined}
            onClick={() => setPage("repository")}
          >
            Repository
          </button>
          <button
            type="button"
            aria-current={
              page === "graph" && graphMode === "3d" ? "page" : undefined
            }
            onClick={() => {
              setGraphMode("3d");
              if (page !== "graph") {
                setInitialFilePath(null);
                setInitialManifest(null);
                setInitialEdgeId(null);
              }
              setPage("graph");
            }}
          >
            3D atlas
          </button>
          <button
            type="button"
            aria-current={
              page === "graph" && graphMode === "2d" ? "page" : undefined
            }
            onClick={() => {
              setGraphMode("2d");
              setPage("graph");
            }}
          >
            2D Graph
          </button>
          <button
            type="button"
            aria-current={page === "findings" ? "page" : undefined}
            onClick={() => setPage("findings")}
          >
            Findings <small>M5</small>
          </button>
          <button type="button" disabled title="Available in M7">
            Assistant <small>M7</small>
          </button>
          <button
            type="button"
            aria-current={page === "settings" ? "page" : undefined}
            onClick={() => setPage("settings")}
          >
            Settings
          </button>
        </nav>
        <span className="repository-label" title={repository?.rootName}>
          {repository?.rootName ??
            (repository === undefined
              ? "Repository status unknown"
              : "No repository selected")}
        </span>
        <div className="top-actions">
          <span className="mode-label">Local mode</span>
          <span
            className={`connection ${connection}`}
            role="status"
            aria-live="polite"
          >
            <span className="status-dot" aria-hidden="true" />
            {statusText}
          </span>
        </div>
      </header>

      <div
        className={`layout ${page === "graph" || page === "findings" ? "graph-layout" : ""}`}
      >
        {(page === "graph" || page === "findings" || page === "settings") && (
          <nav className="sidebar" aria-label="Primary navigation">
            <div className="nav-heading">Explore the archive</div>
            <button
              type="button"
              className="nav-item"
              onClick={() => setPage("workspace")}
            >
              <NavGlyph name="home" /> Overview
            </button>
            <button
              type="button"
              className="nav-item"
              onClick={() => setPage("repository")}
            >
              <NavGlyph name="repository" /> Repository
            </button>
            <button
              type="button"
              className={`nav-item ${page === "graph" && graphMode === "3d" ? "active" : ""}`}
              aria-current={
                page === "graph" && graphMode === "3d" ? "page" : undefined
              }
              onClick={() => {
                setGraphMode("3d");
                if (page !== "graph") {
                  setInitialFilePath(null);
                  setInitialManifest(null);
                  setInitialEdgeId(null);
                }
                setPage("graph");
              }}
            >
              <NavGlyph name="graph" /> 3D Map
            </button>
            <button
              type="button"
              className={`nav-item ${page === "graph" && graphMode === "2d" ? "active" : ""}`}
              aria-current={
                page === "graph" && graphMode === "2d" ? "page" : undefined
              }
              onClick={() => {
                setGraphMode("2d");
                setPage("graph");
              }}
            >
              <NavGlyph name="graph" /> 2D Graph
            </button>
            <button
              type="button"
              className={`nav-item ${page === "findings" ? "active" : ""}`}
              aria-current={page === "findings" ? "page" : undefined}
              onClick={() => setPage("findings")}
            >
              <NavGlyph name="analysis" /> Analysis
            </button>
            <button
              type="button"
              className="nav-item future"
              disabled
              title="Available in M7"
              aria-label="Assistant, available in M7"
            >
              <span className="nav-future-label">
                <NavGlyph name="assistant" /> Assistant
              </span>
              <span className="milestone">M7</span>
            </button>
            <div className="nav-bottom">
              <button
                type="button"
                className={`nav-item ${page === "settings" ? "active" : ""}`}
                aria-current={page === "settings" ? "page" : undefined}
                onClick={() => setPage("settings")}
              >
                <NavGlyph name="settings" /> Settings
              </button>
              <div className="rail-repository">
                <span>Open repository</span>
                <strong title={repository?.rootName}>
                  {repository?.rootName ?? "None selected"}
                </strong>
                <small>
                  {repository
                    ? `Local session · revision ${repository.revision}`
                    : "Select a local root to begin"}
                </small>
                <button type="button" onClick={() => setPage("repository")}>
                  {repository ? "Change repository" : "Open repository"}
                </button>
              </div>
            </div>
          </nav>
        )}

        <main
          className={`main ${page === "graph" || page === "findings" ? "graph-main" : ""}`}
          id="main-content"
        >
          {page === "workspace" ? (
            <Workspace
              repository={repository}
              onOpenRepository={() => setPage("repository")}
              onOpenGraph={() => {
                setGraphMode("3d");
                setInitialFilePath(null);
                setInitialManifest(null);
                setPage("graph");
              }}
            />
          ) : page === "repository" ? (
            <RepositoryPage
              repository={repository}
              connection={connection}
              onChange={onChange}
              onSelectFile={setSelectedFile}
              onStale={onStale}
              startupError={startupError}
            />
          ) : page === "graph" ? (
            <Suspense fallback={<p role="status">Loading graph view…</p>}>
              <GraphPage
                key={
                  repository
                    ? `${repository.repositoryId}:${repository.revision}`
                    : "none"
                }
                repository={repository}
                initialPath={initialFilePath}
                initialManifest={initialManifest}
                initialEdgeId={initialEdgeId}
                connection={connection}
                mode={graphMode}
                onModeChange={setGraphMode}
                onOpenRepository={() => setPage("repository")}
                onStale={onStale}
              />
            </Suspense>
          ) : page === "findings" ? (
            <FindingsPage
              key={
                repository
                  ? `${repository.repositoryId}:${repository.revision}`
                  : "none"
              }
              repository={repository}
              connection={connection}
              onOpenRepository={() => setPage("repository")}
              onStale={onStale}
              onOpenGraph={(path, manifest, mode, edgeId) => {
                setInitialFilePath(path);
                setInitialManifest(manifest);
                setInitialEdgeId(edgeId ?? null);
                setGraphMode(mode);
                setPage("graph");
              }}
            />
          ) : (
            <Settings
              version={version}
              statusText={statusText}
              connection={connection}
              check={check}
            />
          )}
        </main>

        {page !== "graph" && page !== "findings" && (
          <aside className="inspector" aria-label="File details">
            <div className="inspector-heading">
              <span>File details</span>
              <span className="inspector-dash" aria-hidden="true">
                —
              </span>
            </div>
            {selectedFile && repository ? (
              <div className="inspector-empty">
                <span className="inspector-glyph" aria-hidden="true">
                  ◌
                </span>
                <h2 title={selectedFile.name}>{selectedFile.name}</h2>
                <dl className="file-metadata">
                  <dt>Path</dt>
                  <dd title={selectedFile.path}>{selectedFile.path}</dd>
                  <dt>Type</dt>
                  <dd>File</dd>
                  <dt>Size</dt>
                  <dd>
                    {selectedFile.sizeBytes?.toLocaleString() ?? "Unknown"}{" "}
                    bytes
                  </dd>
                  <dt>Modified</dt>
                  <dd>
                    {selectedFile.modifiedAt
                      ? new Date(selectedFile.modifiedAt).toLocaleString()
                      : "Unknown"}
                  </dd>
                  {selectedFile.languageHint && (
                    <>
                      <dt>Language (inferred)</dt>
                      <dd>{selectedFile.languageHint}</dd>
                    </>
                  )}
                </dl>
                <p>
                  Open this file in the graph workspace to inspect supported
                  source. Findings has dependency metrics.
                </p>
                <button
                  type="button"
                  className="inspector-atlas-link"
                  onClick={() => {
                    setInitialFilePath(selectedFile.path);
                    setInitialManifest(null);
                    setPage("graph");
                  }}
                >
                  Open file source in graph workspace
                </button>
              </div>
            ) : (
              <div className="inspector-empty">
                <span className="inspector-glyph" aria-hidden="true">
                  ◌
                </span>
                <h2>No file selected</h2>
                <p>
                  Select a real file in Repository to see basic metadata. Open
                  it in the graph workspace for supported source and evidence.
                </p>
              </div>
            )}
            <span className="inspector-footer">
              {repository ? repository.rootName : "Awaiting a repository"}
            </span>
          </aside>
        )}
      </div>

      <footer className="statusbar">
        <span>
          Local API: <strong className={connection}>{statusText}</strong>
        </span>
        <button
          type="button"
          className="status-retry"
          onClick={() => void check()}
          disabled={connection === "checking"}
        >
          Retry connection
        </button>
        <span className="index-status">
          Repository:{" "}
          <strong>
            {repository
              ? "Selected"
              : repository === undefined
                ? "Unknown"
                : "Not selected"}
          </strong>{" "}
          ·{" "}
          {page === "findings"
            ? "Findings open"
            : `Graph: ${page === "graph" ? "Explorer open" : "Open Graph to analyze"}`}
        </span>
        <span className="status-version">CIE / {version}</span>
      </footer>
    </div>
  );
}
