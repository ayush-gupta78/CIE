import type { Selection } from "./repositoryApi";

export function Workspace({
  repository,
  onOpenRepository,
}: {
  repository: Selection | null | undefined;
  onOpenRepository: () => void;
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
          Browse a local repository to see its real files. Dependency
          connections and graph views are coming in later milestones.
        </p>
        <button
          type="button"
          className="workspace-link"
          onClick={onOpenRepository}
        >
          {repository ? "View repository files" : "Open a repository"}
        </button>
      </div>
      <section className="workspace" aria-label="Graph workspace">
        <div className="workspace-toolbar">
          <span>
            Visualization space{" "}
            <span className="toolbar-caption">/ Graph not built</span>
          </span>
          <div
            className="view-modes"
            role="group"
            aria-label="View modes, not yet available"
          >
            <button type="button" disabled title="3D view available in M3">
              3D <small>M3</small>
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
                ? "Files are available in Repository. Dependency analysis arrives in M2 and the 3D graph in M3."
                : repository === undefined
                  ? "Check the local API status, then open a repository to explore files."
                  : "Open a local repository to browse files. Dependency analysis and graph views follow in later milestones."}
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
