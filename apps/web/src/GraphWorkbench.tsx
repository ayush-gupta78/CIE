import {
  analysisDescription,
  type FileEdge,
  type FileNode,
  type Graph,
} from "./graphApi";
import type { SceneModel } from "./graphModel";

type Props = {
  graph: Graph;
  model: SceneModel;
  selected: FileNode | null;
  onSelect: (id: string) => void;
  onOpenDetail: () => void;
  onEvidence: (edge: FileEdge) => void;
};

export function GraphWorkbench({
  graph,
  model,
  selected,
  onOpenDetail,
  onEvidence,
}: Props) {
  const outgoing = selected ? (model.outgoing.get(selected.id) ?? []) : [];
  const incoming = selected ? (model.incoming.get(selected.id) ?? []) : [];
  return (
    <section className="atlas-workbench" aria-label="File workbench">
      <div className="atlas-panel-heading">
        <span>File context</span>
        <span>Verified local graph</span>
      </div>
      {selected ? (
        <>
          <div className="atlas-file-tab">
            <span className="atlas-file-symbol" aria-hidden="true" />{" "}
            {selected.name}
            <span className="atlas-tab-state">
              {selected.category ?? selected.status}
            </span>
          </div>
          <div className="atlas-file-intro">
            <h2>{selected.name}</h2>
            <p>{selected.path}</p>
            <button type="button" onClick={onOpenDetail}>
              Open file details
            </button>
          </div>
          <div className="atlas-evidence-surface">
            <div className="atlas-code-ruler">
              Static relationship evidence{" "}
              <span>
                {outgoing.length} outgoing · {incoming.length} incoming
              </span>
            </div>
            {outgoing.length ? (
              <ol>
                {outgoing.slice(0, 5).map((edge) => (
                  <li key={edge.id}>
                    <span className="atlas-line-number">
                      {edge.evidence.line}:{edge.evidence.column}
                    </span>
                    <span>
                      <strong>
                        {edge.kind === "reexports" ? "export from" : edge.kind}
                      </strong>{" "}
                      {edge.specifier}
                      <small>
                        →{" "}
                        {graph.files.find((file) => file.id === edge.to)?.path}
                      </small>
                    </span>
                    <button
                      type="button"
                      onClick={() => onEvidence(edge)}
                      aria-label={`View declaration ${edge.id} at line ${edge.evidence.line}`}
                    >
                      View source
                    </button>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="atlas-evidence-empty">
                {selected.status === "parsed"
                  ? "No verified outgoing declarations in this file."
                  : analysisDescription(selected)}
              </p>
            )}
            <p className="atlas-source-lock">
              Open file details to read source. These rows are captured static
              relationship evidence, not file contents.
            </p>
          </div>
        </>
      ) : (
        <div className="atlas-workbench-empty">
          <h2>Select a file to investigate.</h2>
          <p>
            Choose a marker, path in the explorer, or verified connection. The
            workbench will show only captured static evidence.
          </p>
          <span>Open a file for source evidence</span>
        </div>
      )}
    </section>
  );
}

export function GraphNeighborhood({
  model,
  selected,
  onSelect,
}: Pick<Props, "model" | "selected" | "onSelect">) {
  const files = new Map(model.files.map((file) => [file.id, file]));
  const links = selected
    ? [
        ...(model.outgoing.get(selected.id) ?? []).flatMap((edge) =>
          edge.to ? [{ id: edge.to, direction: "Uses" as const }] : [],
        ),
        ...(model.incoming.get(selected.id) ?? []).map((edge) => ({
          id: edge.from,
          direction: "Referenced by" as const,
        })),
      ]
    : [];
  const unique = [
    ...new Map(
      links.map((link) => [`${link.direction}:${link.id}`, link]),
    ).values(),
  ];
  return (
    <aside className="atlas-neighborhood" aria-label="Dependency neighborhood">
      <div className="atlas-panel-heading">
        <span>Dependency neighborhood</span>
        <span>
          {selected ? `${unique.length} related files` : "No file selected"}
        </span>
      </div>
      {selected ? (
        <>
          <div className="atlas-neighborhood-origin">
            <span className="atlas-neighborhood-beacon" aria-hidden="true" />
            {selected.name}
          </div>
          <ul>
            {unique.map((link) => (
              <li key={`${link.direction}:${link.id}`}>
                <button
                  type="button"
                  onClick={() => onSelect(link.id)}
                  title={files.get(link.id)?.path}
                >
                  <small>{link.direction}</small>
                  <span>{files.get(link.id)?.path}</span>
                </button>
              </li>
            ))}
          </ul>
          {!unique.length && <p>No verified one-hop file relationships.</p>}
          <p className="atlas-neighborhood-note">
            Only verified local relationships. This is a list, not the M4 2D
            map.
          </p>
        </>
      ) : (
        <div className="atlas-neighborhood-empty">
          <span className="atlas-file-symbol" aria-hidden="true" />
          <p>
            Direct verified connections appear here when a file is selected.
          </p>
        </div>
      )}
    </aside>
  );
}
