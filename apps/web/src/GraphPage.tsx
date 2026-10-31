import { useEffect, useMemo, useRef, useState } from "react";
import {
  analysisDescription,
  analyzeRepository,
  categoryLabel,
  getGraph,
  type Graph,
  type FileEdge,
} from "./graphApi";
import { layoutGraph, projectGraph } from "./graphModel";
import { GraphScene3D, supportsWebGL } from "./GraphScene3D";
import { GraphScene2D } from "./GraphScene2D";
import { GraphFileTree } from "./GraphFileTree";
import { GraphWorkbench, GraphNeighborhood } from "./GraphWorkbench";
import { FileDetail } from "./FileDetail";
import { Assistant } from "./Assistant";
import type { AiCitation } from "./aiApi";
import { ApiError, currentRepository, type Selection } from "./repositoryApi";
import type { Connection } from "./useLocalHealth";

type Props = {
  repository: Selection | null | undefined;
  initialPath?: string | null;
  initialManifest?: string | null;
  initialEdgeId?: string | null;
  connection: Connection;
  mode?: "3d" | "2d";
  onModeChange?: (mode: "3d" | "2d") => void;
  onOpenRepository: () => void;
  onStale?: () => void;
  assistantRequested?: boolean;
  onOpenSettings?: () => void;
};

export function GraphPage({
  repository,
  initialPath,
  initialManifest,
  initialEdgeId,
  connection,
  mode: controlledMode,
  onModeChange,
  onOpenRepository,
  onStale,
  assistantRequested,
  onOpenSettings,
}: Props) {
  const [graph, setGraph] = useState<Graph | null>(null);
  const [localMode, setLocalMode] = useState<"3d" | "2d">("3d");
  const mode = controlledMode ?? localMode;
  const [detailOpen, setDetailOpen] = useState(false);
  const [assistantOpen, setAssistantOpen] = useState(!!assistantRequested);
  const [citationLine, setCitationLine] = useState<number | null>(null);
  useEffect(() => {
    if (detailOpen && citationLine)
      document
        .querySelector(".archive-detail")
        ?.scrollIntoView({ block: "start" });
  }, [detailOpen, citationLine]);
  useEffect(() => {
    if (assistantRequested) setAssistantOpen(true);
  }, [assistantRequested]);
  const [visited3D, setVisited3D] = useState(mode === "3d" && !initialEdgeId);
  useEffect(() => {
    if (mode === "3d" && !detailOpen) setVisited3D(true);
  }, [mode, detailOpen]);
  const switchMode = (next: "3d" | "2d") => {
    setLocalMode(next);
    onModeChange?.(next);
  };
  const [fit2DToken, setFit2DToken] = useState(0);
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
  const [focus3D, setFocus3D] = useState({
    id: null as string | null,
    module: null as string | null,
    token: 0,
  });
  const [focus2D, setFocus2D] = useState({
    id: null as string | null,
    module: null as string | null,
    token: 0,
  });
  const [resetToken, setResetToken] = useState(0);
  const [orbitToken, setOrbitToken] = useState(0);
  const [cameraCommand, setCameraCommand] = useState<"fit" | "reset">("reset");
  const [hoverPath, setHoverPath] = useState("");
  const [compactPanel, setCompactPanel] = useState<"files" | "details" | null>(
    null,
  );
  const [evidenceId, setEvidenceId] = useState<string | null>(null);
  const [controlsOpen, setControlsOpen] = useState(false);
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
  useEffect(() => {
    if (!initialPath || !visibleGraph) return;
    const file =
      initialManifest && visibleGraph.manifest !== initialManifest
        ? null
        : visibleGraph.files.find((entry) => entry.path === initialPath);
    if (file) {
      const edge =
        initialEdgeId && initialManifest === visibleGraph.manifest
          ? visibleGraph.edges.find(
              (entry) =>
                entry.id === initialEdgeId &&
                entry.resolution === "resolved_static" &&
                entry.from === file.id &&
                entry.to &&
                entry.evidence.path === file.path,
            )
          : null;
      setSelectedId(file.id);
      setEvidenceId(edge?.id ?? null);
      setDetailOpen(!initialManifest || !!edge);
    } else {
      setSelectedId(null);
      setDetailOpen(false);
      setSearch(initialPath);
    }
  }, [initialPath, initialManifest, initialEdgeId, visibleGraph]);

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
      setFit2DToken(0);
      setSelectedId(null);
      setFocus3D({ id: null, module: null, token: 0 });
      setFocus2D({ id: null, module: null, token: 0 });
      setDetailOpen(false);
      setEvidenceId(null);
      setCitationLine(null);
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
        } else {
          setSelectedId(null);
          setFocus2D((old) => ({ ...old, id: null, module: null }));
        }
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
    if (visibleGraph?.files.some((file) => file.id === id)) {
      setSelectedId(id);
      setEvidenceId(null);
    }
  };
  const openEvidence = (edge: FileEdge) => {
    if (
      edge.resolution !== "resolved_static" ||
      !edge.to ||
      !visibleGraph?.files.some(
        (file) => file.id === edge.from && file.path === edge.evidence.path,
      )
    )
      return;
    setSelectedId(edge.from);
    setEvidenceId(edge.id);
    setCitationLine(null);
    setDetailOpen(true);
  };
  const openCitation = (citation: AiCitation) => {
    const file = visibleGraph?.files.find(
      (entry) => entry.id === citation.fileId && entry.path === citation.path,
    );
    if (!file) return;
    setSelectedId(file.id);
    setEvidenceId(citation.edgeId ?? null);
    setCitationLine(citation.startLine ?? null);
    setDetailOpen(true);
  };
  const focus = (id: string) => {
    select(id);
    const setter = mode === "2d" ? setFocus2D : setFocus3D;
    setter((old) => ({ id, module: null, token: old.token + 1 }));
  };
  const focusDirectory = (path: string) => {
    const setter = mode === "2d" ? setFocus2D : setFocus3D;
    setter((old) => ({ id: null, module: path, token: old.token + 1 }));
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
      setFit2DToken((value) => value + 1);
      setSelectedId(null);
      setFocus3D({ id: null, module: null, token: 0 });
      setFocus2D({ id: null, module: null, token: 0 });
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
    setFocus3D((old) => ({ ...old, id: null, module: null }));
    setCameraCommand(command);
    setResetToken((value) => value + 1);
  };
  const fitView = () => {
    if (mode === "2d") {
      setFocus2D((old) => ({ ...old, id: null, module: null }));
      setFit2DToken((value) => value + 1);
    } else camera("fit");
  };
  return (
    <section
      className={`graph-page ${detailOpen && selected ? "detail-open" : ""} ${assistantOpen ? "assistant-open" : ""}`}
      aria-labelledby="graph-heading"
    >
      <div className="graph-heading">
        <div>
          <p className="kicker">
            Repository / {repository?.rootName ?? "Not selected"} /{" "}
            {mode.toUpperCase()} graph
          </p>
          <h1 id="graph-heading">
            {detailOpen && selected
              ? selected.name
              : mode === "3d"
                ? "3D file atlas"
                : "2D file graph"}
          </h1>
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
            <div
              className="graph-mode-switch"
              role="group"
              aria-label="Graph view mode"
            >
              <button
                type="button"
                aria-pressed={mode === "3d"}
                className={mode === "3d" ? "graph-mode-active" : ""}
                onClick={() => switchMode("3d")}
              >
                3D Map
              </button>
              <button
                type="button"
                aria-pressed={mode === "2d"}
                className={mode === "2d" ? "graph-mode-active" : ""}
                onClick={() => switchMode("2d")}
              >
                2D Graph
              </button>
            </div>
            <div className="atlas-top-actions">
              <button
                type="button"
                aria-expanded={assistantOpen}
                onClick={() => setAssistantOpen((open) => !open)}
              >
                Assistant
              </button>
              {detailOpen && (
                <button type="button" onClick={() => setDetailOpen(false)}>
                  Back to atlas
                </button>
              )}
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
          {assistantOpen && (
            <Assistant
              key={visibleGraph?.manifest ?? selectionKey}
              graph={visibleGraph}
              selected={selected}
              connection={connection}
              onOpenSettings={() => onOpenSettings?.()}
              onCitation={openCitation}
            />
          )}
          {initialPath &&
            (!visibleGraph ||
              (initialManifest && visibleGraph.manifest !== initialManifest) ||
              !visibleGraph.files.some(
                (entry) => entry.path === initialPath,
              )) && (
              <p className="atlas-unavailable-file" role="status">
                {visibleGraph
                  ? initialManifest && visibleGraph.manifest !== initialManifest
                    ? `The graph has changed since Findings was opened. Return to Findings for current evidence before opening ${initialPath}.`
                    : `${initialPath} is not in the current analyzed graph. Use Repository for its filesystem metadata.`
                  : `To inspect ${initialPath}, analyze this repository first. Dependency evidence is available only for supported formats.`}
              </p>
            )}
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
          {detailOpen && selected && visibleGraph && model && (
            <FileDetail
              graph={visibleGraph}
              model={model}
              file={selected}
              evidenceId={evidenceId}
              initialLine={citationLine}
              onReanalyze={() => void analyze()}
              onSelect={select}
              onEvidence={openEvidence}
              onFocusModule={(path) => {
                setDetailOpen(false);
                focusDirectory(path);
              }}
              onClose={() => setDetailOpen(false)}
            />
          )}
          <div
            className={`graph-panels ${compactPanel ? `panel-${compactPanel}` : ""} ${detailOpen && selected ? "graph-panels-suspended" : ""}`}
            inert={detailOpen && !!selected}
            aria-hidden={detailOpen && !!selected}
          >
            <section className="graph-files" aria-label="Graph file explorer">
              <div className="graph-panel-title">
                <span>Repository files</span>
                <small>
                  {filtered.length} / {visibleGraph?.files.length ?? 0}
                </small>
              </div>
              <p className="graph-panel-note">
                Eligible repository files. Expand a folder or search for a path.
              </p>
              {visibleGraph && (
                <GraphFileTree
                  files={visibleGraph.files}
                  search={search}
                  selectedId={selectedId}
                  onSelect={focus}
                  onFocusModule={focusDirectory}
                />
              )}
              {visibleGraph && filtered.length === 0 && (
                <p className="graph-panel-note">No matching analyzed files.</p>
              )}
            </section>
            <div
              className={`graph-stage ${mode === "2d" ? "graph-stage-2d" : ""}`}
              aria-label={mode === "2d" ? "2D file graph" : "3D file graph"}
            >
              <div className="atlas-stage-caption" aria-hidden="true">
                <span>
                  {mode === "2d"
                    ? "File connectivity map"
                    : "Spatial source atlas"}
                </span>
                <strong>{repository.rootName}</strong>
              </div>
              {model && layout && model.groups.length > 0 && (
                <div
                  className="atlas-module-key"
                  aria-label="Analyzed directory modules"
                >
                  <span>Mapped directories</span>
                  {[...model.groups]
                    .sort(
                      (a, b) =>
                        b.files.length - a.files.length ||
                        a.path.localeCompare(b.path),
                    )
                    .slice(0, 6)
                    .map((group) => (
                      <div
                        key={group.path}
                        style={{ borderColor: group.color }}
                      >
                        <i
                          style={{ backgroundColor: group.color }}
                          aria-hidden="true"
                        />
                        {group.path === "." ? "root" : group.path}
                        <small>{group.files.length} files</small>
                      </div>
                    ))}
                </div>
              )}
              {model && (
                <div
                  inert={mode !== "2d"}
                  className={`graph-2d-layer ${mode === "2d" ? "active" : ""}`}
                >
                  <GraphScene2D
                    model={model}
                    selectedId={selectedId}
                    search={search}
                    onSelect={select}
                    focusId={focus2D.id}
                    focusModule={focus2D.module}
                    focusToken={focus2D.token}
                    fitToken={fit2DToken}
                    active={mode === "2d"}
                  />
                </div>
              )}
              {visited3D &&
                visibleGraph &&
                model &&
                layout &&
                visibleGraph.files.length > 0 &&
                !webglUnavailable && (
                  <div
                    inert={mode !== "3d"}
                    className={`graph-3d-layer ${mode === "3d" ? "active" : ""}`}
                  >
                    <GraphScene3D
                      model={model}
                      layout={layout}
                      selectedId={selectedId}
                      onSelect={select}
                      showAllLabels={showAllLabels}
                      focusId={focus3D.id}
                      focusModule={focus3D.module}
                      focusToken={focus3D.token}
                      resetToken={resetToken}
                      orbitToken={orbitToken}
                      cameraCommand={cameraCommand}
                      onHover={setHoverPath}
                      onUnavailable={() => setWebglUnavailable(true)}
                    />
                  </div>
                )}
              {visibleGraph &&
              model &&
              layout &&
              visibleGraph.files.length > 0 ? (
                mode === "2d" ? null : webglUnavailable ? (
                  <div className="graph-fallback" role="status">
                    <h2>3D rendering unavailable.</h2>
                    <p>
                      WebGL is unavailable or its context was lost. Use the 2D
                      Graph, file explorer and relationship details to inspect
                      this graph.
                    </p>
                    <button
                      type="button"
                      className="graph-inspector-action"
                      onClick={() => switchMode("2d")}
                    >
                      Open 2D Graph
                    </button>
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
                ) : null
              ) : mode === "2d" && model ? null : (
                <div className="graph-stage-empty">
                  <h2>
                    {loading || analyzing
                      ? "Reading real files…"
                      : visibleGraph
                        ? "No eligible files."
                        : "A graph begins with source."}
                  </h2>
                  <p>
                    {visibleGraph
                      ? "No files were found within the permitted analysis scope."
                      : "Run analysis after selecting a repository. No sample files are shown."}
                  </p>
                </div>
              )}
              {hoverPath && (
                <div className="graph-hover-path" role="status">
                  {hoverPath}
                </div>
              )}
              <button
                type="button"
                className="atlas-tools-toggle"
                aria-expanded={controlsOpen}
                onClick={() => setControlsOpen((value) => !value)}
              >
                {mode === "2d" ? "Graph controls" : "Atlas controls"}
              </button>
              <div
                className={`atlas-stage-controls ${controlsOpen ? "open" : ""}`}
                aria-label={
                  mode === "2d" ? "2D graph controls" : "Atlas controls"
                }
              >
                <button
                  type="button"
                  disabled={
                    !visibleGraph || (mode === "3d" && webglUnavailable)
                  }
                  onClick={fitView}
                >
                  Fit view
                </button>
                <button
                  type="button"
                  disabled={!selected || (mode === "3d" && webglUnavailable)}
                  onClick={() => selected && focus(selected.id)}
                >
                  Focus selected
                </button>
                {mode === "3d" && (
                  <button
                    type="button"
                    aria-pressed={showAllLabels}
                    disabled={!visibleGraph}
                    onClick={() => setShowAllLabels((value) => !value)}
                  >
                    {showAllLabels ? "Key labels" : "All labels"}
                  </button>
                )}
                {mode === "3d" && (
                  <button
                    type="button"
                    disabled={!visibleGraph || webglUnavailable}
                    onClick={() => setOrbitToken((value) => value + 1)}
                  >
                    Rotate view
                  </button>
                )}
                {mode === "3d" && (
                  <button
                    type="button"
                    disabled={!visibleGraph || webglUnavailable}
                    onClick={() => camera("reset")}
                  >
                    Reset orientation
                  </button>
                )}
              </div>
              <div
                className="atlas-selected-card"
                aria-label="Selected file summary"
              >
                {selected && model ? (
                  <>
                    <span>Selected file</span>
                    <h2>{selected.name}</h2>
                    <p title={selected.path}>{selected.path}</p>
                    <dl>
                      <dt>Language</dt>
                      <dd>{selected.language}</dd>
                      <dt>Outgoing</dt>
                      <dd>{model.outgoing.get(selected.id)?.length ?? 0}</dd>
                      <dt>Incoming</dt>
                      <dd>{model.incoming.get(selected.id)?.length ?? 0}</dd>
                    </dl>
                    <button type="button" onClick={() => setDetailOpen(true)}>
                      Open file details
                    </button>
                  </>
                ) : (
                  <>
                    <span>Atlas reading</span>
                    <p>
                      Choose a real file marker or a path in the explorer to
                      trace its verified relationships.
                    </p>
                  </>
                )}
              </div>
              <div className="graph-stage-legend" aria-label="Graph legend">
                <span>
                  <i className="legend-out" /> Verified local relationships:
                  referencing file → referenced file
                </span>
                <span>
                  <i className="legend-in" /> Gold: uses · Blue: referenced by
                </span>
              </div>
            </div>
            {visibleGraph && model ? (
              <GraphWorkbench
                graph={visibleGraph}
                model={model}
                selected={selected}
                onSelect={focus}
                onOpenDetail={() => setDetailOpen(true)}
                onEvidence={openEvidence}
              />
            ) : (
              <section className="atlas-workbench" aria-label="File workbench">
                <div className="atlas-panel-heading">File context</div>
                <div className="atlas-workbench-empty">
                  <h2>A repository makes the atlas.</h2>
                  <p>
                    Analyze supported local source files to reveal verified
                    connections.
                  </p>
                </div>
              </section>
            )}
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
                    <dd>File · {selected.category ?? "source"}</dd>
                    <dt>Category</dt>
                    <dd>{categoryLabel(selected)}</dd>
                    <dt>Language / format</dt>
                    <dd>{selected.language}</dd>
                    <dt>Directory</dt>
                    <dd>{selected.parent}</dd>
                    <dt>Size</dt>
                    <dd>
                      {selected.sizeBytes === undefined
                        ? "Unknown"
                        : `${selected.sizeBytes.toLocaleString()} bytes`}
                    </dd>
                    <dt>Dependency analysis</dt>
                    <dd>{analysisDescription(selected)}</dd>
                    <dt>Parse status</dt>
                    <dd>{selected.status}</dd>
                  </dl>
                  <button
                    type="button"
                    className="graph-inspector-action"
                    onClick={() => focus(selected.id)}
                    disabled={mode === "3d" && webglUnavailable}
                  >
                    Focus file
                  </button>
                  <button
                    type="button"
                    className="graph-inspector-action"
                    onClick={() => {
                      setSelectedId(null);
                      setFocus2D((old) => ({
                        ...old,
                        id: null,
                        module: null,
                      }));
                    }}
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
                        <button
                          type="button"
                          onClick={() => openEvidence(edge)}
                        >
                          View source declaration · {edge.evidence.path}:
                          {edge.evidence.line}
                        </button>
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
                        <button
                          type="button"
                          onClick={() => openEvidence(edge)}
                        >
                          View source declaration · {edge.evidence.path}:
                          {edge.evidence.line}
                        </button>
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
            {model ? (
              <GraphNeighborhood
                model={model}
                selected={selected}
                onSelect={focus}
              />
            ) : (
              <aside
                className="atlas-neighborhood"
                aria-label="Dependency neighborhood"
              >
                <div className="atlas-panel-heading">
                  Dependency neighborhood
                </div>
                <p>Direct verified links appear after analysis.</p>
              </aside>
            )}
          </div>
          <p className="graph-control-hint">
            {mode === "2d"
              ? "Drag empty space to pan · Scroll, pinch or use zoom buttons · Fit view or focus a file/directory · / search · Esc clears selection."
              : "Drag to orbit · Right-drag or two fingers to pan · Scroll or pinch to zoom · Select a file to trace dependencies · / search · Esc clears selection."}
          </p>
        </>
      )}
    </section>
  );
}
