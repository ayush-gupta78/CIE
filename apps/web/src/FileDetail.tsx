import type { FileNode, Graph } from "./graphApi";
import type { SceneModel } from "./graphModel";
import { GraphFileTree } from "./GraphFileTree";
import { Crest } from "./Crest";

export function FileDetail({
  graph,
  model,
  file,
  onSelect,
  onFocusModule,
  onClose,
}: {
  graph: Graph;
  model: SceneModel;
  file: FileNode;
  onSelect: (id: string) => void;
  onFocusModule: (path: string) => void;
  onClose: () => void;
}) {
  const outgoing = model.outgoing.get(file.id) ?? [];
  const incoming = model.incoming.get(file.id) ?? [];
  const byId = new Map(graph.files.map((node) => [node.id, node]));
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
            3D atlas
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
            <dt>Parse status</dt>
            <dd>{file.status}</dd>
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
          <span>Source · M6</span>
        </div>
        <div
          className="archive-evidence-editor"
          aria-label="Captured dependency declarations"
        >
          <div className="archive-editor-heading">
            <span>{file.path}</span>
            <span>M2 static analysis</span>
          </div>
          {outgoing.length ? (
            <ol>
              {outgoing.map((edge) => (
                <li key={edge.id}>
                  <span className="archive-editor-line">
                    {edge.evidence.line}:{edge.evidence.column}
                  </span>
                  <span>
                    <b>{edge.kind === "reexports" ? "re-export" : "import"}</b>{" "}
                    <em>{edge.specifier}</em>
                    <small>→ {byId.get(edge.to ?? "")?.path}</small>
                  </span>
                </li>
              ))}
            </ol>
          ) : (
            <p>No verified outgoing declarations in this file.</p>
          )}
          <div className="archive-source-unavailable">
            Source preview is planned for M6. No source bytes are loaded here.
          </div>
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
          Only resolved static imports and re-exports from the selected
          repository revision appear here.
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
              </li>
            ))}
          </ul>
          {!incoming.length && <p>No verified incoming links.</p>}
        </section>
        <div className="archive-planned">
          <Crest />
          <p>
            AI notes and source inspection are planned for M7 and M6. This view
            contains only M2 graph evidence.
          </p>
        </div>
      </aside>
    </section>
  );
}
