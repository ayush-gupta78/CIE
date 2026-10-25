import { useEffect, useMemo, useRef, useState } from "react";
import { analyzeRepository, getGraph, type Graph } from "./graphApi";
import { layoutGraph, projectGraph } from "./graphModel";
import { GraphScene3D, supportsWebGL } from "./GraphScene3D";
import { ApiError, type Selection } from "./repositoryApi";
import type { Connection } from "./useLocalHealth";

type Props = {
  repository: Selection | null | undefined;
  connection: Connection;
  onOpenRepository: () => void;
};
export function GraphPage({ repository, connection, onOpenRepository }: Props) {
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
  const [focusToken, setFocusToken] = useState(0);
  const [resetToken, setResetToken] = useState(0);
  const fetchGeneration = useRef(0);
  const analysisGeneration = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const activeKey = useRef<string | null>(null);
  const loadedKey = useRef<string | null>(null);
  const selectionKey = repository
    ? `${repository.repositoryId}:${repository.revision}`
    : "none";

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
      setSearch("");
      setError("");
      setNoGraph(false);
    }
    if (!repository || connection !== "connected") return;
    if (loadedKey.current === selectionKey) return;
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
      .catch((issue: unknown) => {
        if (fetchGeneration.current !== current || next.signal.aborted) return;
        if (issue instanceof ApiError && issue.code === "NO_GRAPH")
          setNoGraph(true);
        else
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
    // selectionKey is the authoritative revision identity; repository object comes from App state.
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
    const clear = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelectedId(null);
    };
    window.addEventListener("keydown", clear);
    return () => window.removeEventListener("keydown", clear);
  }, []);
  const model = useMemo(() => (graph ? projectGraph(graph) : null), [graph]);
  const layout = useMemo(() => (model ? layoutGraph(model) : null), [model]);
  const selected = graph?.files.find((file) => file.id === selectedId) ?? null;
  const filtered =
    graph?.files.filter((file) =>
      file.path.toLocaleLowerCase().includes(search.toLocaleLowerCase()),
    ) ?? [];
  const relatedFile = (id: string) =>
    graph?.files.find((file) => file.id === id);
  const select = (id: string) => {
    if (graph?.files.some((file) => file.id === id)) setSelectedId(id);
  };
  const focus = (id: string) => {
    select(id);
    setFocusId(id);
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
      setResetToken((value) => value + 1);
    } catch (issue) {
      if (analysisGeneration.current === current && !next.signal.aborted)
        setError(
          issue instanceof Error ? issue.message : "Analysis unavailable.",
        );
    } finally {
      if (analysisGeneration.current === current) setAnalyzing(false);
    }
  }

  return (
    <section className="graph-page" aria-labelledby="graph-heading">
      <div className="graph-heading">
        <div>
          <p className="kicker">Spatial dependency map</p>
          <h1 id="graph-heading">Your files, in relation.</h1>
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
          <p>Open a local repository before building a graph.</p>
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
                disabled={!graph}
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
                onClick={() => setShowAllLabels((value) => !value)}
                disabled={!graph}
              >
                {showAllLabels ? "Key labels" : "All labels"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setFocusId(null);
                  setResetToken((value) => value + 1);
                }}
                disabled={!graph || webglUnavailable}
              >
                Fit view
              </button>
              <button
                type="button"
                onClick={() => {
                  setFocusId(null);
                  setResetToken((value) => value + 1);
                  setSelectedId(null);
                }}
                disabled={!graph}
              >
                Reset
              </button>
              <button
                type="button"
                onClick={() => void analyze()}
                disabled={connection !== "connected" || analyzing || loading}
              >
                {analyzing
                  ? "Analyzing…"
                  : graph
                    ? "Re-analyze"
                    : "Analyze repository"}
              </button>
            </div>
          </div>
          <div className="graph-summary" role="status">
            {graph
              ? `${graph.files.length} files · ${graph.counts.resolved} verified connection${graph.counts.resolved === 1 ? "" : "s"} · ${graph.counts.unresolved} unresolved · ${graph.counts.skipped} skipped${graph.partial ? " · Partial analysis" : ""}`
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
          <div className="graph-panels">
            <section className="graph-files" aria-label="Graph file explorer">
              <div className="graph-panel-title">
                <span>Repository files</span>
                <small>
                  {filtered.length} / {graph?.files.length ?? 0}
                </small>
              </div>
              <p className="graph-panel-note">
                Analyzed source files only. Choose a name to inspect its links.
              </p>
              <ul aria-label="Graph files">
                {model?.groups.map((group) => {
                  const shown = group.files.filter((file) =>
                    filtered.includes(file),
                  );
                  return shown.length ? (
                    <li key={group.path}>
                      <details open>
                        <summary>
                          <span
                            className="graph-group-dot"
                            style={{ backgroundColor: group.color }}
                          />
                          {group.path === "." ? "root" : group.path}{" "}
                          <small>{shown.length}</small>
                        </summary>
                        <ul>
                          {shown.map((file) => (
                            <li key={file.id}>
                              <button
                                type="button"
                                title={file.path}
                                className={`graph-file-button ${file.id === selectedId ? "selected" : ""}`}
                                aria-pressed={file.id === selectedId}
                                onClick={() => focus(file.id)}
                              >
                                <span>{file.name}</span>
                                <small>{file.path}</small>
                                {file.status === "failed" && (
                                  <em>Parse failed</em>
                                )}
                              </button>
                            </li>
                          ))}
                        </ul>
                      </details>
                    </li>
                  ) : null;
                })}
              </ul>
              {graph && filtered.length === 0 && (
                <p className="graph-panel-note">No matching analyzed files.</p>
              )}
            </section>
            <div className="graph-stage" aria-label="3D file graph">
              {graph && model && layout && graph.files.length > 0 ? (
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
                    focusToken={focusToken}
                    resetToken={resetToken}

                    onUnavailable={() => setWebglUnavailable(true)}
                  />
                )
              ) : (
                <div className="graph-stage-empty">
                  <h2>
                    {loading || analyzing
                      ? "Reading real files…"
                      : graph
                        ? "No supported source files."
                        : "A graph begins with source."}
                  </h2>
                  <p>
                    {graph
                      ? "This analysis found no supported TypeScript or JavaScript files."
                      : "Run analysis after selecting a repository. No sample files are shown."}
                  </p>
                </div>
              )}
              <div className="graph-stage-legend" aria-label="Graph legend">
                <span>
                  <i className="legend-out" /> Arrow: importer → imported file
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
                  <dl>
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
                          {edge.kind} · {edge.evidence.path}:
                          {edge.evidence.line}
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
                          {edge.kind} · {edge.evidence.path}:
                          {edge.evidence.line}
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
              {graph && (
                <div className="graph-diagnostics">
                  <h3>Coverage</h3>
                  <p>
                    {graph.partial
                      ? "Partial analysis: some files or relations are unsupported."
                      : "Static source analysis available."}
                  </p>
                  <p>
                    {graph.diagnostics.length} diagnostics ·{" "}
                    {graph.counts.skipped} skipped
                  </p>
                  <ul>
                    {graph.diagnostics.slice(0, 6).map((diagnostic, index) => (
                      <li
                        key={`${diagnostic.path}:${diagnostic.line ?? 0}:${diagnostic.code}:${index}`}
                      >
                        {diagnostic.code} · {diagnostic.path}
                        {diagnostic.line ? `:${diagnostic.line}` : ""}
                      </li>
                    ))}
                  </ul>
                  {graph.diagnostics.length > 6 && (
                    <p>
                      {graph.diagnostics.length - 6} more diagnostics in the API
                      response.
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
            to zoom · Select a file to trace dependencies · Esc clears
            selection.
          </p>
        </>
      )}
    </section>
  );
}
