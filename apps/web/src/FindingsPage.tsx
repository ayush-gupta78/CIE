import { useEffect, useMemo, useRef, useState } from "react";
import {
  analyzeRepository,
  getGraph,
  type FileEdge,
  type Graph,
} from "./graphApi";
import {
  getImpact,
  getInsights,
  type Impact,
  type Insights,
} from "./findingsApi";
import { ApiError, currentRepository, type Selection } from "./repositoryApi";
import type { Connection } from "./useLocalHealth";

type Props = {
  repository: Selection | null | undefined;
  connection: Connection;
  onOpenRepository: () => void;
  onOpenGraph: (
    path: string,
    manifest: string,
    mode: "2d" | "3d",
    edgeId?: string,
  ) => void;
  onStale?: () => void;
};
export function FindingsPage({
  repository,
  connection,
  onOpenRepository,
  onOpenGraph,
  onStale,
}: Props) {
  const [graph, setGraph] = useState<Graph | null>(null);
  const [insights, setInsights] = useState<Insights | null>(null);
  const [impact, setImpact] = useState<Impact | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<
    | "path"
    | "connections"
    | "dependents"
    | "dependencies"
    | "transitiveDependents"
    | "transitiveDependencies"
  >("path");
  const [impactRequest, setImpactRequest] = useState<{
    fileId: string;
    token: number;
  } | null>(null);
  const [impactLoading, setImpactLoading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [noGraph, setNoGraph] = useState(false);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const generation = useRef(0);
  const impactGeneration = useRef(0);
  const analysisGeneration = useRef(0);
  const analysisController = useRef<AbortController | null>(null);
  const key = repository
    ? `${repository.repositoryId}:${repository.revision}`
    : "none";
  const published =
    repository &&
    graph?.repositoryId === repository.repositoryId &&
    graph.revision === repository.revision &&
    insights?.manifest === graph.manifest
      ? insights
      : null;
  const selected = published?.files.find((f) => f.id === selectedId) ?? null;
  const declarations = useMemo(() => {
    const pairs = new Map<string, FileEdge[]>();
    for (const edge of graph?.edges ?? []) {
      if (edge.resolution !== "resolved_static" || !edge.to) continue;
      const key = `${edge.from}\0${edge.to}`;
      pairs.set(key, [...(pairs.get(key) ?? []), edge]);
    }
    return pairs;
  }, [graph]);
  const sourceActions = (from: string, to: string) =>
    (declarations.get(`${from}\0${to}`) ?? []).map((edge) => {
      const referencing = graph?.files.find((file) => file.id === edge.from);
      const target = graph?.files.find((file) => file.id === edge.to);
      if (!referencing || !target || !graph) return null;
      return (
        <button
          key={edge.id}
          type="button"
          aria-label={`View source declaration ${referencing.path}:${edge.evidence.line} → ${target.path}`}
          onClick={() =>
            onOpenGraph(referencing.path, graph.manifest, "2d", edge.id)
          }
        >
          View source declaration · {referencing.path}:{edge.evidence.line} →{" "}
          {target.path}
        </button>
      );
    });
  const shown = useMemo(
    () =>
      [...(published?.files ?? [])]
        .filter((f) =>
          f.path.toLocaleLowerCase().includes(search.toLocaleLowerCase()),
        )
        .sort(
          (a, b) =>
            (sort === "path"
              ? 0
              : sort === "connections"
                ? b.directDependents +
                  b.directDependencies -
                  a.directDependents -
                  a.directDependencies
                : sort === "dependents"
                  ? b.directDependents - a.directDependents
                  : sort === "dependencies"
                    ? b.directDependencies - a.directDependencies
                    : sort === "transitiveDependents"
                      ? b.transitiveDependents - a.transitiveDependents
                      : b.transitiveDependencies - a.transitiveDependencies) ||
            a.path.localeCompare(b.path),
        ),
    [published, search, sort],
  );

  useEffect(() => {
    generation.current++;
    impactGeneration.current++;
    analysisGeneration.current++;
    analysisController.current?.abort();
    setGraph(null);
    setInsights(null);
    setImpact(null);
    setImpactRequest(null);
    setImpactLoading(false);
    setSelectedId(null);
    setLoading(false);
    setAnalyzing(false);
    setNoGraph(false);
    setError("");
    setSearch("");
    // Selection identity, not routine health polling, invalidates a published snapshot.
  }, [key]);
  useEffect(() => {
    if (connection !== "connected" || !repository || analyzing) return;
    const verify = () => {
      if (document.visibilityState === "visible")
        setRefresh((value) => value + 1);
    };
    window.addEventListener("focus", verify);
    return () => window.removeEventListener("focus", verify);
  }, [key, connection, analyzing]);
  async function reconcileIdentity(
    issue: unknown,
    expected: Selection,
    signal: AbortSignal,
  ) {
    if (
      !(issue instanceof ApiError) ||
      ![
        "STALE_REPOSITORY",
        "NO_REPOSITORY_SELECTED",
        "INVALID_RESPONSE",
      ].includes(issue.code)
    )
      return false;
    let actual: Selection | null = null;
    try {
      actual = await currentRepository(signal);
    } catch {
      if (issue.code === "INVALID_RESPONSE" || signal.aborted) return false;
      // An explicit stale reply cannot leave old findings actionable when selection lookup fails.
    }
    if (signal.aborted) return true;
    setGraph(null);
    setInsights(null);
    setImpact(null);
    setImpactRequest(null);
    setSelectedId(null);
    if (
      actual &&
      actual.repositoryId === expected.repositoryId &&
      actual.revision === expected.revision
    ) {
      if (issue.code === "STALE_REPOSITORY") {
        setRefresh((value) => value + 1);
        return true;
      }
      return false;
    }
    onStale?.();
    return true;
  }
  useEffect(() => {
    if (!repository || connection !== "connected") return;
    const controller = new AbortController();
    const current = ++generation.current;
    if (refresh) {
      setGraph(null);
      setInsights(null);
      setImpact(null);
      setImpactRequest(null);
      setImpactLoading(false);
      setSelectedId(null);
      setNoGraph(false);
    }
    setLoading(true);
    setError("");
    void (async () => {
      try {
        const snapshot = await getGraph(repository, controller.signal);
        const data = await getInsights(repository, snapshot, controller.signal);
        if (controller.signal.aborted || generation.current !== current) return;
        setGraph(snapshot);
        setInsights(data);
        setNoGraph(false);
      } catch (issue) {
        if (controller.signal.aborted || generation.current !== current) return;
        if (await reconcileIdentity(issue, repository, controller.signal))
          return;
        if (controller.signal.aborted || generation.current !== current) return;
        if (issue instanceof ApiError && issue.code === "NO_GRAPH") {
          setGraph(null);
          setInsights(null);
          setImpact(null);
          setImpactRequest(null);
          setSelectedId(null);
          setNoGraph(true);
          void currentRepository(controller.signal)
            .then((actual) => {
              if (
                !controller.signal.aborted &&
                generation.current === current &&
                (!actual ||
                  actual.repositoryId !== repository.repositoryId ||
                  actual.revision !== repository.revision)
              )
                onStale?.();
            })
            .catch(() => {});
        } else {
          setGraph(null);
          setInsights(null);
          setImpact(null);
          setError(
            issue instanceof Error ? issue.message : "Findings unavailable.",
          );
        }
      } finally {
        if (generation.current === current) setLoading(false);
      }
    })();
    return () => {
      generation.current++;
      controller.abort();
    };
    // Health checking must not cancel an explicit analysis.
  }, [key, connection, refresh]);
  useEffect(() => {
    if (
      !repository ||
      !graph ||
      !selectedId ||
      impactRequest?.fileId !== selectedId ||
      analyzing ||
      connection !== "connected"
    )
      return;
    const controller = new AbortController();
    const current = ++impactGeneration.current;
    setImpact(null);
    setImpactLoading(true);
    void getImpact(repository, graph, selectedId, controller.signal)
      .then((data) => {
        if (!controller.signal.aborted && current === impactGeneration.current)
          setImpact(data);
      })
      .catch(async (issue: unknown) => {
        if (controller.signal.aborted || current !== impactGeneration.current)
          return;
        if (await reconcileIdentity(issue, repository, controller.signal))
          return;
        if (!controller.signal.aborted && current === impactGeneration.current)
          setError(
            issue instanceof Error ? issue.message : "Impact unavailable.",
          );
      })
      .finally(() => {
        if (current === impactGeneration.current) setImpactLoading(false);
      });
    return () => {
      impactGeneration.current++;
      controller.abort();
    };
  }, [key, graph, selectedId, impactRequest, connection, analyzing]);
  useEffect(
    () => () => {
      generation.current++;
      impactGeneration.current++;
      analysisGeneration.current++;
      analysisController.current?.abort();
    },
    [],
  );
  async function analyze() {
    if (!repository || connection !== "connected" || analyzing) return;
    const controller = new AbortController();
    analysisController.current?.abort();
    analysisController.current = controller;
    const current = ++analysisGeneration.current;
    generation.current++;
    setLoading(false);
    setAnalyzing(true);
    setError("");
    try {
      const snapshot = await analyzeRepository(repository, controller.signal);
      if (controller.signal.aborted || analysisGeneration.current !== current)
        return;
      generation.current++;
      impactGeneration.current++;
      setGraph(null);
      setInsights(null);
      setImpact(null);
      setImpactRequest(null);
      setImpactLoading(false);
      setSelectedId(null);
      setLoading(false);
      const data = await getInsights(repository, snapshot, controller.signal);
      if (controller.signal.aborted || analysisGeneration.current !== current)
        return;
      impactGeneration.current++;
      setGraph(snapshot);
      setInsights(data);
      setImpact(null);
      setSelectedId(null);
      setNoGraph(false);
    } catch (issue) {
      if (
        !controller.signal.aborted &&
        analysisGeneration.current === current
      ) {
        if (await reconcileIdentity(issue, repository, controller.signal))
          return;
        if (
          !controller.signal.aborted &&
          analysisGeneration.current === current
        )
          setError(
            issue instanceof Error ? issue.message : "Analysis unavailable.",
          );
      }
    } finally {
      if (analysisGeneration.current === current) setAnalyzing(false);
    }
  }
  return (
    <section className="findings-page" aria-labelledby="findings-heading">
      <header className="findings-head">
        <div>
          <p className="kicker">
            Repository / {repository?.rootName ?? "Not selected"} / Analysis
          </p>
          <h1 id="findings-heading">Findings</h1>
          <p>
            Verified static relationships from the local repository snapshot.
          </p>
        </div>
        {repository && (
          <button
            type="button"
            disabled={connection !== "connected" || analyzing}
            onClick={() => void analyze()}
          >
            {analyzing
              ? "Analyzing…"
              : published
                ? "Re-analyze"
                : "Analyze repository"}
          </button>
        )}
      </header>
      {!repository ? (
        <div className="findings-empty">
          <h2>
            {repository === undefined
              ? "Checking repository…"
              : "No repository selected"}
          </h2>
          <button type="button" onClick={onOpenRepository}>
            Open repository
          </button>
        </div>
      ) : (
        <>
          {connection === "disconnected" && (
            <p role="alert">
              Local API is offline. Published findings may be stale until
              reconnection.
            </p>
          )}
          {error && <p role="alert">{error}</p>}
          {loading && !published && <p role="status">Loading findings…</p>}
          {noGraph && !published && (
            <p role="status">
              No analysis yet. Analyze this repository to produce findings.
            </p>
          )}
          {published && graph && (
            <>
              <div className="findings-metrics" aria-label="Repository metrics">
                {(
                  [
                    ["Files", published.totals.files],
                    ["Relationships", published.totals.relationships],
                    ["Declarations", published.totals.declarations],
                    ["Unresolved", published.totals.unresolved],
                    ["External", published.totals.external],
                    ["Cycle groups", published.totals.cycleGroups],
                    ["Cycle files", published.totals.cycleFiles],
                    ["Isolated", published.totals.isolated],
                  ] as const
                ).map(([label, count]) => (
                  <div key={label}>
                    <span>{label}</span>
                    <strong>{count}</strong>
                  </div>
                ))}
              </div>
              <div className="findings-columns">
                <section aria-label="Analyzed files" className="findings-list">
                  <h2>Files</h2>
                  <div className="findings-filters">
                    <label>
                      Search findings
                      <input
                        type="search"
                        value={search}
                        onChange={(event) => setSearch(event.target.value)}
                      />
                    </label>
                    <label>
                      Sort by
                      <select
                        value={sort}
                        onChange={(event) =>
                          setSort(event.target.value as typeof sort)
                        }
                      >
                        <option value="path">Path</option>
                        <option value="connections">
                          Most connected (distinct files)
                        </option>
                        <option value="dependents">Direct dependents</option>
                        <option value="dependencies">
                          Direct dependencies
                        </option>
                        <option value="transitiveDependents">
                          Transitive dependents
                        </option>
                        <option value="transitiveDependencies">
                          Transitive dependencies
                        </option>
                      </select>
                    </label>
                  </div>
                  <p>
                    {shown.length} of {published.files.length} files
                  </p>
                  <ul>
                    {shown.map((f) => (
                      <li key={f.id}>
                        <button
                          type="button"
                          aria-label={`Select ${f.path}`}
                          aria-pressed={selectedId === f.id}
                          onClick={() => {
                            setSelectedId(f.id);
                            setImpact(null);
                            setImpactRequest(null);
                            setImpactLoading(false);
                            setError("");
                          }}
                        >
                          <span>{f.path}</span>
                          <small>
                            {f.status} · {f.directDependents} direct dependents
                            · {f.directDependencies} direct dependencies ·{" "}
                            {f.transitiveDependents} transitive dependents ·{" "}
                            {f.transitiveDependencies} transitive dependencies
                          </small>
                        </button>
                      </li>
                    ))}
                  </ul>
                  {shown.length === 0 && <p>No matching files.</p>}
                </section>
                <section
                  className="findings-detail"
                  aria-label="Selected file findings"
                >
                  {selected ? (
                    <>
                      <h2>{selected.path}</h2>
                      <p>Status: {selected.status}</p>
                      <dl>
                        <dt>Direct dependencies</dt>
                        <dd>{selected.directDependencies}</dd>
                        <dt>Direct dependents</dt>
                        <dd>{selected.directDependents}</dd>
                        <dt>Transitive dependencies</dt>
                        <dd>{selected.transitiveDependencies}</dd>
                        <dt>Transitive dependents</dt>
                        <dd>{selected.transitiveDependents}</dd>
                      </dl>
                      <p>
                        {selected.cycleIds.length
                          ? `Verified cycle group${selected.cycleIds.length === 1 ? "" : "s"}: ${selected.cycleIds.join(", ")}`
                          : "No verified cycle membership for this file."}
                      </p>
                      <div className="findings-actions">
                        <button
                          type="button"
                          disabled={connection !== "connected" || analyzing}
                          onClick={() => {
                            setError("");
                            setImpactRequest((old) => ({
                              fileId: selected.id,
                              token: (old?.token ?? 0) + 1,
                            }));
                          }}
                        >
                          Run impact analysis
                        </button>
                        {(["2d", "3d"] as const).map((mode) => (
                          <button
                            key={mode}
                            type="button"
                            onClick={() =>
                              onOpenGraph(selected.path, graph.manifest, mode)
                            }
                          >
                            Open {selected.path} in {mode.toUpperCase()}{" "}
                            {mode === "3d" ? "atlas" : "Graph"}
                          </button>
                        ))}
                      </div>
                      <h3>Direct verified declarations</h3>
                      <div className="findings-source-actions">
                        {[...declarations]
                          .filter(([pair]) =>
                            pair.split("\0").includes(selected.id),
                          )
                          .flatMap(([pair]) => {
                            const [from, to] = pair.split("\0");
                            return sourceActions(from, to);
                          })}
                      </div>
                      <h3>Impact · affected paths</h3>
                      <p>
                        Potential reachability through known static references;
                        not a prediction of runtime breakage.
                      </p>
                      {impact?.fileId === selected.id ? (
                        <>
                          <p>
                            {impact.total} affected · {impact.direct.length}{" "}
                            direct · {impact.indirect.length} indirect
                          </p>
                          <ol>
                            {impact.affected.map((a) => (
                              <li key={a.id}>
                                <button
                                  type="button"
                                  aria-label={`Select impacted ${a.path}`}
                                  onClick={() => {
                                    setSelectedId(a.id);
                                    setImpact(null);
                                    setImpactRequest(null);
                                    setImpactLoading(false);
                                  }}
                                >
                                  {a.path}
                                </button>{" "}
                                · {a.distance === 1 ? "Direct" : "Indirect"}
                                <button
                                  type="button"
                                  onClick={() =>
                                    onOpenGraph(a.path, graph.manifest, "2d")
                                  }
                                >
                                  Open {a.path} in 2D Graph
                                </button>
                                <small>
                                  Chain:{" "}
                                  {a.chain
                                    .map(
                                      (id) =>
                                        published.files.find((f) => f.id === id)
                                          ?.path,
                                    )
                                    .join(" → ")}
                                </small>
                                <div
                                  className="findings-source-actions"
                                  aria-label={`Verified steps to ${a.path}`}
                                >
                                  {a.chain.slice(1).map((id, index) => (
                                    <div key={`${id}:${index}`}>
                                      Step {index + 1}:{" "}
                                      {
                                        published.files.find((f) => f.id === id)
                                          ?.path
                                      }{" "}
                                      →{" "}
                                      {
                                        published.files.find(
                                          (f) => f.id === a.chain[index],
                                        )?.path
                                      }
                                      {sourceActions(id, a.chain[index])}
                                    </div>
                                  ))}
                                </div>
                              </li>
                            ))}
                          </ol>
                          {impact.total === 0 && (
                            <p>No verified affected paths.</p>
                          )}
                        </>
                      ) : impactLoading ? (
                        <p>Loading impact…</p>
                      ) : connection !== "connected" ? (
                        <p>Impact unavailable offline.</p>
                      ) : (
                        <p>
                          Run impact analysis for this file to trace verified
                          dependents.
                        </p>
                      )}
                    </>
                  ) : (
                    <p>Select a file for dependency and impact details.</p>
                  )}
                </section>
              </div>
              <section className="findings-cycles">
                <h2>Cycle groups · {published.cycles.length}</h2>
                {published.cycles.length === 0 ? (
                  <p>
                    No cycles were found among verified static relationships.
                  </p>
                ) : (
                  published.cycles.map((cycle) => (
                    <article key={cycle.id}>
                      <h3>Cycle {cycle.id}</h3>
                      <p>
                        {cycle.files.length} participating file
                        {cycle.files.length === 1 ? "" : "s"}
                      </p>
                      <ul>
                        {cycle.files.map((id) => {
                          const file = published.files.find(
                            (f) => f.id === id,
                          )!;
                          return (
                            <li key={id}>
                              <button
                                type="button"
                                aria-label={`Open ${file.path} from cycle ${cycle.id}`}
                                onClick={() =>
                                  onOpenGraph(file.path, graph.manifest, "2d")
                                }
                              >
                                {file.path}
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                      <p>
                        Witness:{" "}
                        {cycle.witness
                          .map(
                            (id) =>
                              published.files.find((f) => f.id === id)?.path,
                          )
                          .join(" → ")}
                      </p>
                      <p>
                        {cycle.relationships.length} distinct verified
                        relationships within this group
                      </p>
                      <ul>
                        {cycle.relationships.map(({ from, to }) => (
                          <li key={`${from}:${to}`}>
                            {published.files.find((f) => f.id === from)?.path} →{" "}
                            {published.files.find((f) => f.id === to)?.path}
                            <div className="findings-source-actions">
                              {sourceActions(from, to)}
                            </div>
                          </li>
                        ))}
                      </ul>
                    </article>
                  ))
                )}
              </section>
              <section className="findings-coverage">
                <h2>Coverage</h2>
                <dl>
                  {Object.entries(published.totals.statuses).map(
                    ([status, count]) => (
                      <div key={status}>
                        <dt>{status}</dt>
                        <dd>{count}</dd>
                      </div>
                    ),
                  )}
                </dl>
                <p>
                  Unknown relationships may exist in partial, unsupported,
                  skipped or failed files. External and unresolved declarations
                  are not verified local relationships; impact and cycles use
                  verified links only.
                </p>
                <details>
                  <summary>Files with incomplete dependency coverage</summary>
                  <ul>
                    {published.files
                      .filter((f) => f.status !== "parsed")
                      .map((f) => {
                        const diagnostics = graph.diagnostics.filter(
                          (d) => d.path === f.path,
                        );
                        return (
                          <li key={f.id}>
                            <span>
                              {f.path} · {f.status}
                            </span>
                            {diagnostics.length > 0 && (
                              <small>
                                {" "}
                                ·{" "}
                                {diagnostics
                                  .map(
                                    (d) =>
                                      `${d.code}${d.line ? `:${d.line}` : ""}`,
                                  )
                                  .join(", ")}
                              </small>
                            )}
                          </li>
                        );
                      })}
                  </ul>
                  {published.files.every((f) => f.status === "parsed") && (
                    <p>
                      All discovered files have parsed status; static analysis
                      still cannot prove runtime completeness.
                    </p>
                  )}
                </details>
              </section>
            </>
          )}
        </>
      )}
    </section>
  );
}
