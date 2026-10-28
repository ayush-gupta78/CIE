import { useEffect, useMemo, useRef, useState } from "react";
import {
  analysisDescription,
  categoryLabel,
  type FileNode,
  type Graph,
  type FileEdge,
} from "./graphApi";
import { getSource, type Source } from "./sourceApi";
import { ApiError } from "./repositoryApi";
import type { SceneModel } from "./graphModel";
import { GraphFileTree } from "./GraphFileTree";
import { Crest } from "./Crest";
import { highlightLine } from "./sourceHighlight";

export function FileDetail({
  graph,
  model,
  file,
  evidenceId,
  initialLine,
  onReanalyze,
  onEvidence,
  onSelect,
  onFocusModule,
  onClose,
}: {
  graph: Graph;
  model: SceneModel;
  file: FileNode;
  evidenceId: string | null;
  initialLine?: number | null;
  onReanalyze: () => void;
  onEvidence: (edge: FileEdge) => void;
  onSelect: (id: string) => void;
  onFocusModule: (path: string) => void;
  onClose: () => void;
}) {
  const outgoing = model.outgoing.get(file.id) ?? [];
  const incoming = model.incoming.get(file.id) ?? [];
  const byId = new Map(graph.files.map((node) => [node.id, node]));
  const [source, setSource] = useState<Source | null>(null);
  const [error, setError] = useState<ApiError | Error | null>(null);
  const [line, setLine] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const sourceList = useRef<HTMLOListElement>(null);
  const codeArea = useRef<HTMLDivElement>(null);
  const identity = `${graph.repositoryId}:${graph.revision}:${graph.manifest}:${file.id}`;
  const lines = useMemo(() => {
    if (!source?.text) return [];
    return source.text
      .split("\n")
      .slice(0, source.text.endsWith("\n") ? -1 : undefined)
      .map((text, index) => ({
        text,
        html:
          source.text.length <= 32768
            ? highlightLine(text, file.path, index + 1)
            : null,
      }));
  }, [source, file.path]);
  const edgesByLine = useMemo(() => {
    const grouped = new Map<number, FileEdge[]>();
    for (const edge of model.outgoing.get(file.id) ?? [])
      grouped.set(edge.evidence.line, [
        ...(grouped.get(edge.evidence.line) ?? []),
        edge,
      ]);
    return grouped;
  }, [model, file.id]);
  useEffect(() => {
    const controller = new AbortController();
    setSource(null);
    setError(null);
    setLoading(true);
    void getSource(graph, file, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) setSource(result);
      })
      .catch((issue: unknown) => {
        if (!controller.signal.aborted)
          setError(
            issue instanceof Error ? issue : new Error("Source unavailable."),
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [identity]);
  const evidence = outgoing.find((edge) => edge.id === evidenceId);
  useEffect(
    () => setLine(evidence?.evidence.line ?? initialLine ?? null),
    [identity, evidenceId, initialLine],
  );
  useEffect(() => {
    if (!source || !line || !codeArea.current) return;
    const row = sourceList.current?.querySelector<HTMLElement>(
      `[data-line="${line}"]`,
    );
    if (row)
      codeArea.current.scrollTop =
        row.offsetTop -
        codeArea.current.offsetTop -
        codeArea.current.clientHeight / 2;
  }, [source, line]);
  return (
    <section className="archive-detail" aria-label="File detail">
      <aside className="archive-detail-tree" aria-label="File detail explorer">
        <div className="atlas-panel-heading">
          <span>Repository structure</span>
          <span>{graph.files.length} analyzed files</span>
        </div>
        <h2>File explorer</h2>
        <p>Choose a real file to continue tracing.</p>
        <GraphFileTree
          files={graph.files}
          search=""
          selectedId={file.id}
          onSelect={onSelect}
          onFocusModule={onFocusModule}
        />
      </aside>
      <article className="archive-parchment archive-article">
        <div className="archive-paper-corner" aria-hidden="true" />
        <nav className="archive-breadcrumb" aria-label="File path">
          <button type="button" onClick={onClose}>
            Graph workspace
          </button>
          <span>/</span>
          <span>{file.parent === "." ? "root" : file.parent}</span>
        </nav>
        <div className="archive-article-head">
          <Crest className="archive-detail-crest" />
          <div>
            <h1>{file.name}</h1>
            <p>{file.path}</p>
          </div>
        </div>
        <dl className="archive-detail-metadata">
          <div>
            <dt>Language</dt>
            <dd>{file.language}</dd>
          </div>
          <div>
            <dt>Category / size</dt>
            <dd>
              {categoryLabel(file)} ·{" "}
              {file.sizeBytes === undefined
                ? "Unknown size"
                : `${file.sizeBytes.toLocaleString()} bytes`}
            </dd>
          </div>
          <div>
            <dt>Dependency analysis</dt>
            <dd>{analysisDescription(file)}</dd>
          </div>
          <div>
            <dt>Verified declarations</dt>
            <dd>
              {outgoing.length} outgoing · {incoming.length} incoming
            </dd>
          </div>
        </dl>
        <div className="archive-paper-tabs" aria-label="Detail sections">
          <span className="current">Evidence</span>
          <span>Source</span>
        </div>
        <div
          ref={codeArea}
          className="archive-evidence-editor"
          aria-label="Captured dependency declarations"
        >
          <div className="archive-editor-heading">
            <span>{file.path}</span>
            <span>Static relationship evidence</span>
          </div>
          {outgoing.length ? (
            <ol>
              {outgoing.map((edge) => (
                <li key={edge.id}>
                  <span className="archive-editor-line">
                    {edge.evidence.line}:{edge.evidence.column}
                  </span>
                  <span>
                    <b>{edge.kind === "reexports" ? "re-export" : edge.kind}</b>{" "}
                    <em>{edge.specifier}</em>
                    <small>→ {byId.get(edge.to ?? "")?.path}</small>
                  </span>
                </li>
              ))}
            </ol>
          ) : (
            <p>
              {file.status === "parsed"
                ? "No verified outgoing declarations in this file."
                : analysisDescription(file)}
            </p>
          )}
          {loading && <p role="status">Loading source…</p>}
          {error && (
            <p role="alert">
              {error instanceof ApiError && error.code === "STALE_SOURCE"
                ? "Source changed since analysis; declaration locations cannot be verified."
                : error.message}{" "}
              {error instanceof ApiError &&
                (error.code.startsWith("STALE") ||
                  error.code === "NO_GRAPH") && (
                  <button type="button" onClick={onReanalyze}>
                    Re-analyze repository
                  </button>
                )}
            </p>
          )}
          {source &&
            source.fileId === file.id &&
            source.manifest === graph.manifest && (
              <>
                <p className="archive-source-status" role="status">
                  {source.freshness === "verified"
                    ? "Verified source at analyzed snapshot"
                    : "Source available; dependency evidence not verified"}{" "}
                  · {source.lineCount} lines
                </p>
                {evidence && source.freshness === "verified" && (
                  <p className="archive-source-evidence">
                    {evidence.kind} · {evidence.specifier} →{" "}
                    {byId.get(evidence.to ?? "")?.path} · line{" "}
                    {evidence.evidence.line}:{evidence.evidence.column}
                  </p>
                )}
                <div className="archive-source-actions">
                  <label>
                    Go to line{" "}
                    <input
                      type="number"
                      min="1"
                      max={source.lineCount}
                      value={line ?? ""}
                      onChange={(event) => {
                        const next = Number(event.target.value);
                        if (
                          Number.isSafeInteger(next) &&
                          next >= 1 &&
                          next <= source.lineCount
                        )
                          setLine(next);
                      }}
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() =>
                      void navigator.clipboard?.writeText(source.text)
                    }
                  >
                    Copy source
                  </button>
                </div>
                <ol
                  ref={sourceList}
                  className="archive-source-lines"
                  aria-label="Source lines"
                >
                  {lines.map(({ text, html }, index) => {
                    const number = index + 1;
                    const edges =
                      source.freshness === "verified"
                        ? (edgesByLine.get(number) ?? [])
                        : [];
                    return (
                      <li
                        key={number}
                        data-line={number}
                        className={
                          line === number && source.freshness === "verified"
                            ? "active"
                            : ""
                        }
                      >
                        <button
                          type="button"
                          aria-label={`Line ${number}`}
                          aria-current={
                            line === number ? "location" : undefined
                          }
                          onClick={() => setLine(number)}
                        >
                          {number}
                        </button>
                        {html === null ? (
                          <code>{text || "\u00a0"}</code>
                        ) : (
                          <code
                            dangerouslySetInnerHTML={{
                              __html: html || "&nbsp;",
                            }}
                          />
                        )}
                        {edges.map((edge) => (
                          <button
                            key={edge.id}
                            type="button"
                            className="archive-source-edge"
                            onClick={() => {
                              setLine(number);
                              onEvidence(edge);
                            }}
                            aria-label={`View declaration ${edge.id} at line ${number}`}
                          >
                            {edge.kind} → {byId.get(edge.to ?? "")?.path}
                          </button>
                        ))}
                      </li>
                    );
                  })}
                </ol>
              </>
            )}
        </div>
      </article>
      <aside
        className="archive-parchment archive-detail-notes"
        aria-label="File relationship notes"
      >
        <div className="archive-paper-corner" aria-hidden="true" />
        <div className="archive-panel-overline">Verified file evidence</div>
        <h2>Relationships</h2>
        <p className="archive-ink-copy">
          Only verified local relationships from the selected repository
          revision appear here.
        </p>
        <section>
          <h3>
            Uses <span>{outgoing.length}</span>
          </h3>
          <ul>
            {outgoing.map((edge) => (
              <li key={edge.id}>
                <button type="button" onClick={() => onSelect(edge.to!)}>
                  {byId.get(edge.to ?? "")?.path}
                </button>
                <small>
                  {edge.kind} · {edge.evidence.path}:{edge.evidence.line}:
                  {edge.evidence.column}
                </small>
                <button type="button" onClick={() => onEvidence(edge)}>
                  View source declaration · {edge.evidence.path}:
                  {edge.evidence.line}
                </button>
              </li>
            ))}
          </ul>
          {!outgoing.length && <p>No verified outgoing links.</p>}
        </section>
        <section>
          <h3>
            Referenced by <span>{incoming.length}</span>
          </h3>
          <ul>
            {incoming.map((edge) => (
              <li key={edge.id}>
                <button type="button" onClick={() => onSelect(edge.from)}>
                  {byId.get(edge.from)?.path}
                </button>
                <small>
                  {edge.kind} · {edge.evidence.path}:{edge.evidence.line}:
                  {edge.evidence.column}
                </small>
                <button type="button" onClick={() => onEvidence(edge)}>
                  View source declaration · {edge.evidence.path}:
                  {edge.evidence.line}
                </button>
              </li>
            ))}
          </ul>
          {!incoming.length && <p>No verified incoming links.</p>}
        </section>
      </aside>
    </section>
  );
}
