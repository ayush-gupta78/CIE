import type { Selection } from "./repositoryApi";

export function Workspace({
  repository,
  onOpenRepository,
  onOpenGraph,
}: {
  repository: Selection | null | undefined;
  onOpenRepository: () => void;
  onOpenGraph: () => void;
}) {
  return (
    <>
      <div className="intro">
        <p className="kicker">Your workspace</p>
        <h1>
          Understand how
          <br />
          your code connects.
        </h1>
        <p className="intro-copy">
          Browse real files, then analyze their static connections in the 3D
          Graph.
        </p>
        <button
          type="button"
          className="workspace-link"
          onClick={onOpenRepository}
        >
          {repository ? "View repository files" : "Open a repository"}
        </button>
        {repository && (
          <button
            type="button"
            className="workspace-link"
            onClick={onOpenGraph}
          >
            Explore 3D Graph
          </button>
        )}
      </div>
      <section className="workspace" aria-label="Graph workspace">
        <div className="workspace-toolbar">
          <span>
            Visualization space{" "}
            <span className="toolbar-caption">/ Open Graph to analyze</span>
          </span>
          <div
            className="view-modes"
            role="group"
            aria-label="Graph view modes"
          >
            <button
              type="button"
              disabled={!repository}
              onClick={onOpenGraph}
              title={repository ? "Open 3D Graph" : "Open a repository first"}
            >
              3D
            </button>
            <button type="button" disabled title="2D view available in M4">
              2D <small>M4</small>
            </button>
          </div>
        </div>
        <div className="stage">
          <div className="stage-corner stage-corner-top" aria-hidden="true" />
          <div className="empty-state">
            <div className="empty-rule" aria-hidden="true" />
            <p className="empty-overline">An open canvas</p>
            <h2>
              {repository
                ? "No graph generated."
                : repository === undefined
                  ? "Repository status unknown."
                  : "No repository loaded."}
            </h2>
            <p>
              {repository
                ? "Open Graph to analyze supported source files and explore their verified connections in 3D."
                : repository === undefined
                  ? "Check the local API status, then open a repository to explore files."
                  : "Open a local repository to browse files. Then use Graph for 3D dependency exploration."}
            </p>
          </div>
          <div
            className="stage-corner stage-corner-bottom"
            aria-hidden="true"
          />
          <span className="stage-footnote">
            The graph begins with real files.
          </span>
        </div>
      </section>
    </>
  );
}
