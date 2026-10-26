import { useEffect, useMemo, useRef, useState } from "react";
import { analyzeRepository, getGraph, type Graph } from "./graphApi";
import { layoutGraph, projectGraph } from "./graphModel";
import { GraphScene3D, supportsWebGL } from "./GraphScene3D";
import { GraphFileTree } from "./GraphFileTree";
import { ApiError, currentRepository, type Selection } from "./repositoryApi";
import type { Connection } from "./useLocalHealth";

type Props = {
  repository: Selection | null | undefined;
  connection: Connection;
  onOpenRepository: () => void;
  onStale?: () => void;
};

export function GraphPage({
  repository,
  connection,
  onOpenRepository,
  onStale,
}: Props) {
  const [graph, setGraph] = useState<Graph | null>(null);
  const [loading, setLoading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [noGraph, setNoGraph] = useState(false);
  const [error, setError] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [showAllLabels, setShowAllLabels] = useState(false);
  const [webglUnavailable, setWebglUnavailable] = useState(
    () => !supportsWebGL(),
  );
  const [focusId, setFocusId] = useState<string | null>(null);
  const [focusModule, setFocusModule] = useState<string | null>(null);
  const [focusToken, setFocusToken] = useState(0);
  const [resetToken, setResetToken] = useState(0);
  const [orbitToken, setOrbitToken] = useState(0);
  const [cameraCommand, setCameraCommand] = useState<"fit" | "reset">("reset");
  const [hoverPath, setHoverPath] = useState("");
  const [compactPanel, setCompactPanel] = useState<"files" | "details" | null>(
    null,
  );
  const fetchGeneration = useRef(0);
  const analysisGeneration = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const activeKey = useRef<string | null>(null);
  const loadedKey = useRef<string | null>(null);
  const selectionKey = repository
    ? `${repository.repositoryId}:${repository.revision}`
    : "none";
  const visibleGraph =
    graph &&
    repository &&
    graph.repositoryId === repository.repositoryId &&
    graph.revision === repository.revision
      ? graph
      : null;

  async function handleIdentityIssue(
    issue: unknown,
    expected: Selection,
    signal: AbortSignal,
  ) {
    if (!(issue instanceof ApiError)) return false;
    let stale =
      issue.code === "STALE_REPOSITORY" ||
      issue.code === "NO_REPOSITORY_SELECTED";
    if (!stale && issue.code === "INVALID_RESPONSE") {
      try {
        const actual = await currentRepository(signal);
        stale =
          !actual ||
          actual.repositoryId !== expected.repositoryId ||
          actual.revision !== expected.revision;
      } catch {
        /* Report the original failure when the selection cannot be checked. */
      }
    }
    if (!stale || signal.aborted) return false;
    setGraph(null);
    setSelectedId(null);
    onStale?.();
    return true;
  }

  useEffect(() => {
    if (activeKey.current !== selectionKey) {
      activeKey.current = selectionKey;
      loadedKey.current = null;
      fetchGeneration.current++;
      analysisGeneration.current++;
      controller.current?.abort();
      setLoading(false);
      setAnalyzing(false);
      setGraph(null);
      setSelectedId(null);
      setFocusId(null);
      setFocusModule(null);
      setSearch("");
      setError("");
      setNoGraph(false);
    }
    if (
      !repository ||
      connection !== "connected" ||
      loadedKey.current === selectionKey
    )
      return;
    loadedKey.current = selectionKey;
    const current = ++fetchGeneration.current;
    const next = new AbortController();
    controller.current = next;
    setLoading(true);
    let completed = false;
    void getGraph(repository, next.signal)
      .then((result) => {
        if (fetchGeneration.current === current && !next.signal.aborted)
          setGraph(result);
      })
      .catch(async (issue: unknown) => {
        if (fetchGeneration.current !== current || next.signal.aborted) return;
        if (await handleIdentityIssue(issue, repository, next.signal)) return;
        if (fetchGeneration.current !== current || next.signal.aborted) return;
        if (issue instanceof ApiError && issue.code === "NO_GRAPH") {
          setNoGraph(true);
          // NO_GRAPH also follows a switch in another tab; do not block analysis while checking.
          void currentRepository(next.signal)
            .then((actual) => {
              if (
                !next.signal.aborted &&
                fetchGeneration.current === current &&
                (!actual ||
                  actual.repositoryId !== repository.repositoryId ||
                  actual.revision !== repository.revision)
              ) {
                setGraph(null);
                setSelectedId(null);
                onStale?.();
              }
            })
            .catch(() => {});
        } else
          setError(
            issue instanceof Error ? issue.message : "Graph unavailable.",
          );
      })
      .finally(() => {
        completed = true;
        if (fetchGeneration.current === current) setLoading(false);
      });
    return () => {
      fetchGeneration.current++;
      next.abort();
      if (!completed && loadedKey.current === selectionKey)
        loadedKey.current = null;
    };
    // selectionKey is the revision identity; health polling never cancels an analysis.
  }, [selectionKey, connection]);
  useEffect(
    () => () => {
      fetchGeneration.current++;
      analysisGeneration.current++;
      controller.current?.abort();
    },
    [],
  );
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (
          document.activeElement instanceof HTMLInputElement &&
          document.activeElement.type === "search"
        ) {
          setSearch("");
          document.activeElement.blur();
        } else setSelectedId(null);
      }
      if (
        event.key === "/" &&
        !(document.activeElement instanceof HTMLInputElement)
      ) {
        event.preventDefault();
        document
          .querySelector<HTMLInputElement>(".graph-search input")
          ?.focus();
      }
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, []);

  const model = useMemo(
    () => (visibleGraph ? projectGraph(visibleGraph) : null),
    [visibleGraph],
  );
  const layout = useMemo(() => (model ? layoutGraph(model) : null), [model]);
  const selected =
    visibleGraph?.files.find((file) => file.id === selectedId) ?? null;
  const filtered =
    visibleGraph?.files.filter((file) =>
      file.path.toLocaleLowerCase().includes(search.toLocaleLowerCase()),
    ) ?? [];
  const relatedFile = (id: string) =>
    visibleGraph?.files.find((file) => file.id === id);
  const select = (id: string) => {
    if (visibleGraph?.files.some((file) => file.id === id)) setSelectedId(id);
  };
  const focus = (id: string) => {
    select(id);
    setFocusId(id);
    setFocusModule(null);
    setFocusToken((value) => value + 1);
  };
  async function analyze() {
    if (!repository || connection !== "connected" || analyzing) return;
    controller.current?.abort();
    fetchGeneration.current++;
    setLoading(false);
    const next = new AbortController();
    const current = ++analysisGeneration.current;
    controller.current = next;
    setAnalyzing(true);
    setError("");
    try {
      const result = await analyzeRepository(repository, next.signal);
      if (analysisGeneration.current !== current || next.signal.aborted) return;
      setGraph(result);
      setNoGraph(false);
      setSelectedId(null);
      setFocusId(null);
      setFocusModule(null);
      setCameraCommand("reset");
      setResetToken((value) => value + 1);
    } catch (issue) {
      if (
        analysisGeneration.current === current &&
        !next.signal.aborted &&
        !(await handleIdentityIssue(issue, repository, next.signal))
      )
        setError(
          issue instanceof Error ? issue.message : "Analysis unavailable.",
        );
    } finally {
      if (analysisGeneration.current === current) setAnalyzing(false);
    }
  }
  const camera = (command: "fit" | "reset") => {
    setFocusId(null);
    setFocusModule(null);
    setCameraCommand(command);
    setResetToken((value) => value + 1);
  };
  return (
    <section className="graph-page" aria-labelledby="graph-heading">
      <div className="graph-heading">
        <div>
          <p className="kicker">
            Repository / {repository?.rootName ?? "Not selected"} / 3D graph
          </p>
          <h1 id="graph-heading">File relationships</h1>
        </div>
        <span className="graph-repository-name" title={repository?.rootName}>
          {repository?.rootName ?? "No repository"}
        </span>
      </div>
      {!repository ? (
        <div className="graph-empty">
          <h2>
            {repository === undefined
              ? "Checking repository…"
              : "No repository selected."}
          </h2>
          <p>
            {repository === undefined
              ? "Checking the local selection. If the server restarted, reopen a repository."
              : "Open a local repository before building a graph."}
          </p>
          <button type="button" onClick={onOpenRepository}>
            Open repository
          </button>
        </div>
      ) : (
        <>
          <div className="graph-toolbar">
            <label className="graph-search">
              Search files
              <input
                type="search"
                aria-label="Search files"
                placeholder="Filename or relative path"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                disabled={!visibleGraph}
              />
            </label>
            <div className="graph-toolbar-actions">
              <button
                type="button"
                aria-pressed="true"
                className="graph-mode-active"
              >
                3D
              </button>
              <button
                type="button"
                disabled
                title="Available in M4"
                aria-label="2D available in M4"
              >
                2D <small>M4</small>
              </button>
              <button
                type="button"
                aria-pressed={showAllLabels}
                disabled={!visibleGraph}
                onClick={() => setShowAllLabels((value) => !value)}
              >
                {showAllLabels ? "Key labels" : "All labels"}
              </button>
              <button
                type="button"
                disabled={!visibleGraph || webglUnavailable}
                onClick={() => camera("fit")}
              >
                Fit view
              </button>
              <button
                type="button"
                disabled={!visibleGraph || webglUnavailable}
                onClick={() => setOrbitToken((value) => value + 1)}
              >
                Rotate view
              </button>
              <button
                type="button"
                disabled={!visibleGraph || webglUnavailable}
                onClick={() => camera("reset")}
              >
                Reset orientation
              </button>
              <button
                type="button"
                disabled={connection !== "connected" || analyzing || loading}
                onClick={() => void analyze()}
              >
                {analyzing
                  ? "Analyzing…"
                  : visibleGraph
                    ? "Re-analyze"
                    : "Analyze repository"}
              </button>
            </div>
          </div>
          <div className="graph-compact-tabs" aria-label="Graph panels">
            <button
              type="button"
              aria-expanded={compactPanel === "files"}
              onClick={() =>
                setCompactPanel(compactPanel === "files" ? null : "files")
              }
            >
              Files ({visibleGraph?.files.length ?? 0})
            </button>
            <button
              type="button"
              aria-expanded={compactPanel === "details"}
              onClick={() =>
                setCompactPanel(compactPanel === "details" ? null : "details")
              }
            >
              Inspector{selected ? ` · ${selected.name}` : ""}
            </button>
          </div>
          <div className="graph-summary" role="status">
            {visibleGraph
              ? `${visibleGraph.files.length} files · ${visibleGraph.counts.resolved} verified connection${visibleGraph.counts.resolved === 1 ? "" : "s"} · ${visibleGraph.counts.unresolved} unresolved · ${visibleGraph.counts.skipped} skipped${visibleGraph.partial ? " · Partial analysis" : ""}`
              : loading
                ? "Loading graph…"
                : noGraph
                  ? "No analysis yet. Analyze this repository to see its real file graph."
                  : "No graph loaded."}
          </div>
          {error && (
            <p className="tree-error" role="alert">
              {error}{" "}
              <button
                type="button"
                className="inline-button"
                onClick={() => void analyze()}
                disabled={connection !== "connected" || analyzing}
              >
                Retry analysis
              </button>
            </p>
          )}
          {connection === "disconnected" && (
            <p className="tree-error" role="alert">
              Local API is offline. Reconnect before analyzing a repository.
            </p>
          )}
          <div
            className={`graph-panels ${compactPanel ? `panel-${compactPanel}` : ""}`}
          >
            <section className="graph-files" aria-label="Graph file explorer">
              <div className="graph-panel-title">
                <span>Repository files</span>
                <small>
                  {filtered.length} / {visibleGraph?.files.length ?? 0}
                </small>
              </div>
              <p className="graph-panel-note">
                Analyzed source files only. Expand a folder or search for a
                path.
              </p>
              {visibleGraph && (
                <GraphFileTree
                  files={visibleGraph.files}
                  search={search}
                  selectedId={selectedId}
                  onSelect={focus}
                  onFocusModule={(path) => {
                    setFocusId(null);
                    setFocusModule(path);
                    setFocusToken((value) => value + 1);
                  }}
                />
              )}
              {visibleGraph && filtered.length === 0 && (
                <p className="graph-panel-note">No matching analyzed files.</p>
              )}
            </section>
            <div className="graph-stage" aria-label="3D file graph">
              {visibleGraph &&
              model &&
              layout &&
              visibleGraph.files.length > 0 ? (
                webglUnavailable ? (
                  <div className="graph-fallback" role="status">
                    <h2>3D rendering unavailable.</h2>
                    <p>
                      WebGL is unavailable or its context was lost. Use the file
                      explorer and relationship details to inspect this graph.
                    </p>
                    {supportsWebGL() && (
                      <button
                        type="button"
                        className="graph-inspector-action"
                        onClick={() => setWebglUnavailable(false)}
                      >
                        Retry 3D renderer
                      </button>
                    )}
                  </div>
                ) : (
                  <GraphScene3D
                    model={model}
                    layout={layout}
                    selectedId={selectedId}
                    onSelect={select}
                    showAllLabels={showAllLabels}
                    focusId={focusId}
                    focusModule={focusModule}
                    focusToken={focusToken}
                    resetToken={resetToken}
                    orbitToken={orbitToken}
                    cameraCommand={cameraCommand}
                    onHover={setHoverPath}
                    onUnavailable={() => setWebglUnavailable(true)}
                  />
                )
              ) : (
                <div className="graph-stage-empty">
                  <h2>
                    {loading || analyzing
                      ? "Reading real files…"
                      : visibleGraph
                        ? "No supported source files."
                        : "A graph begins with source."}
                  </h2>
                  <p>
                    {visibleGraph
                      ? "This analysis found no supported TypeScript or JavaScript files."
                      : "Run analysis after selecting a repository. No sample files are shown."}
                  </p>
                </div>
              )}
              {hoverPath && (
                <div className="graph-hover-path" role="status">
                  {hoverPath}
                </div>
              )}
              <div className="graph-stage-legend" aria-label="Graph legend">
                <span>
                  <i className="legend-out" /> Verified imports / re-exports:
                  importer → referenced file
                </span>
                <span>
                  <i className="legend-in" /> Gold: uses · Blue: referenced by
                </span>
              </div>
            </div>
            <aside className="graph-inspector" aria-label="Graph file details">
              <div className="graph-panel-title">File relationships</div>
              {selected && model ? (
                <>
                  <h2 title={selected.path}>{selected.name}</h2>
                  <p className="graph-inspector-path">{selected.path}</p>
                  <div className="graph-counts">
                    <div>
                      <strong>
                        {model.outgoing.get(selected.id)?.length ?? 0}
                      </strong>
                      <span>Outgoing</span>
                    </div>
                    <div>
                      <strong>
                        {model.incoming.get(selected.id)?.length ?? 0}
                      </strong>
                      <span>Incoming</span>
                    </div>
                  </div>
                  <dl>
                    <dt>Type</dt>
                    <dd>File · {selected.name.split(".").at(-1)}</dd>
                    <dt>Language</dt>
                    <dd>{selected.language}</dd>
                    <dt>Parse status</dt>
                    <dd>{selected.status}</dd>
                  </dl>
                  <button
                    type="button"
                    className="graph-inspector-action"
                    onClick={() => focus(selected.id)}
                    disabled={webglUnavailable}
                  >
                    Focus file
                  </button>
                  <button
                    type="button"
                    className="graph-inspector-action"
                    onClick={() => setSelectedId(null)}
                  >
                    Clear selection
                  </button>
                  <h3>
                    Outgoing / uses ·{" "}
                    {model.outgoing.get(selected.id)?.length ?? 0}
                  </h3>
                  <ul>
                    {model.outgoing.get(selected.id)?.map((edge) => (
                      <li key={edge.id}>
                        <button
                          type="button"
                          title={relatedFile(edge.to!)?.path}
                          onClick={() => focus(edge.to!)}
                        >
                          {relatedFile(edge.to!)?.path}
                        </button>
                        <small>
                          {edge.kind} · {edge.specifier} · {edge.evidence.path}:
                          {edge.evidence.line}:{edge.evidence.column}
                        </small>
                      </li>
                    ))}
                  </ul>
                  <h3>
                    Incoming / referenced by ·{" "}
                    {model.incoming.get(selected.id)?.length ?? 0}
                  </h3>
                  <ul>
                    {model.incoming.get(selected.id)?.map((edge) => (
                      <li key={edge.id}>
                        <button
                          type="button"
                          title={relatedFile(edge.from)?.path}
                          onClick={() => focus(edge.from)}
                        >
                          {relatedFile(edge.from)?.path}
                        </button>
                        <small>
                          {edge.kind} · {edge.specifier} · {edge.evidence.path}:
                          {edge.evidence.line}:{edge.evidence.column}
                        </small>
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <p className="graph-panel-note">
                  Select a file to trace its relationships.
                </p>
              )}
              {visibleGraph && (
                <div className="graph-diagnostics">
                  <h3>Coverage</h3>
                  <p>
                    {visibleGraph.partial
                      ? "Partial analysis: some files or relations are unsupported."
                      : "Static source analysis available."}
                  </p>
                  <p>
                    {visibleGraph.diagnostics.length} diagnostics ·{" "}
                    {visibleGraph.counts.skipped} skipped
                  </p>
                  <ul>
                    {visibleGraph.diagnostics
                      .slice(0, 6)
                      .map((diagnostic, index) => (
                        <li
                          key={`${diagnostic.path}:${diagnostic.line ?? 0}:${diagnostic.code}:${index}`}
                        >
                          {diagnostic.code} · {diagnostic.path}
                          {diagnostic.line ? `:${diagnostic.line}` : ""}
                        </li>
                      ))}
                  </ul>
                  {visibleGraph.diagnostics.length > 6 && (
                    <p>
                      {visibleGraph.diagnostics.length - 6} more diagnostics in
                      the API response.
                    </p>
                  )}
                  <p>
                    External and unresolved imports are not drawn as verified
                    links.
                  </p>
                </div>
              )}
            </aside>
          </div>
          <p className="graph-control-hint">
            Drag to orbit · Right-drag or two fingers to pan · Scroll or pinch
            to zoom · Select a file to trace dependencies · / search · Esc
            clears selection.
          </p>
        </>
      )}
    </section>
  );
}
