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

import { currentRepository, type Entry, type Selection } from "./repositoryApi";

type Page = "workspace" | "repository" | "graph" | "settings";
const GraphPage = lazy(() =>
  import("./GraphPage").then((module) => ({ default: module.GraphPage })),
);

const future = [
  { label: "Insights", milestone: "M5" },
  { label: "AI", milestone: "M7" },
];

export function App() {
  const [page, setPage] = useState<Page>("workspace");
  const { connection, version, check } = useLocalHealth();
  const [repository, setRepository] = useState<Selection | null | undefined>(
    undefined,
  );
  const [selectedFile, setSelectedFile] = useState<Entry | null>(null);
  const [startupError, setStartupError] = useState("");
  const previousConnection = useRef(connection);
  const selectionGeneration = useRef(0);
  const loadSelection = useCallback(async (signal: AbortSignal) => {
    const current = ++selectionGeneration.current;
    try {
      const result = await currentRepository(signal);
      if (!signal.aborted && selectionGeneration.current === current) {
        setRepository(result);
        setSelectedFile(null);
        setStartupError("");
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
    if (
      connection === "connected" &&
      previousConnection.current === "disconnected"
    ) {
      // A restarted local server loses its in-memory selection. Verify before showing old data.
      setRepository(undefined);
    }
    previousConnection.current = connection;
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
    setStartupError("");
  };
  const onStale = useCallback(() => {
    selectionGeneration.current++;
    setRepository(undefined);
    setSelectedFile(null);
  }, []);

  const statusText =
    connection === "connected"
      ? "Connected"
      : connection === "checking"
        ? "Checking"
        : "Disconnected";

  return (
    <div className="shell">
      <header className="topbar">
        <div
          className="brand"
          aria-label="CIE, AI Codebase Intelligence Engine"
        >
          <span className="brand-mark">CIE</span>
          <span className="brand-name">Codebase intelligence</span>
        </div>
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
          <button
            className="top-settings"
            type="button"
            onClick={() => setPage("settings")}
          >
            Settings
          </button>
        </div>
      </header>

      <div className={`layout ${page === "graph" ? "graph-layout" : ""}`}>
        <nav className="sidebar" aria-label="Primary navigation">
          <div className="nav-heading">Navigate</div>
          <button
            type="button"
            className={`nav-item ${page === "workspace" ? "active" : ""}`}
            aria-current={page === "workspace" ? "page" : undefined}
            onClick={() => setPage("workspace")}
          >
            Workspace
          </button>
          <button
            type="button"
            className={`nav-item ${page === "repository" ? "active" : ""}`}
            aria-current={page === "repository" ? "page" : undefined}
            onClick={() => setPage("repository")}
          >
            Repository
          </button>
          <button
            type="button"
            className={`nav-item ${page === "graph" ? "active" : ""}`}
            aria-current={page === "graph" ? "page" : undefined}
            onClick={() => setPage("graph")}
          >
            Graph
          </button>
          {future.map(({ label, milestone }) => (
            <button
              type="button"
              className="nav-item future"
              key={label}
              disabled
              title={`Available in ${milestone}`}
              aria-label={`${label}, available in ${milestone}`}
            >
              <span>{label}</span>
              <span className="milestone">{milestone}</span>
            </button>
          ))}
          <div className="nav-bottom">
            <button
              type="button"
              className={`nav-item ${page === "settings" ? "active" : ""}`}
              aria-current={page === "settings" ? "page" : undefined}
              onClick={() => setPage("settings")}
            >
              Settings
            </button>
            <p>
              Private by default.
              <br />
              Built for local exploration.
            </p>
          </div>
        </nav>

        <main
          className={`main ${page === "graph" ? "graph-main" : ""}`}
          id="main-content"
        >
          {page === "workspace" ? (
            <Workspace
              repository={repository}
              onOpenRepository={() => setPage("repository")}
              onOpenGraph={() => setPage("graph")}
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
                connection={connection}
                onOpenRepository={() => setPage("repository")}
                onStale={onStale}
              />
            </Suspense>
          ) : (
            <Settings
              version={version}
              statusText={statusText}
              connection={connection}
              check={check}
            />
          )}
        </main>

        {page !== "graph" && (
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
                  Source preview and dependency insights arrive in later
                  milestones.
                </p>
              </div>
            ) : (
              <div className="inspector-empty">
                <span className="inspector-glyph" aria-hidden="true">
                  ◌
                </span>
                <h2>No file selected</h2>
                <p>
                  Select a real file in Repository to see basic metadata. Source
                  preview and dependency insights arrive later.
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
          · Graph:{" "}
          {page === "graph" ? "Explorer open" : "Open Graph to analyze"}
        </span>
        <span className="status-version">CIE / {version}</span>
      </footer>
    </div>
  );
}
