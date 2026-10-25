export function Workspace() {
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
          A place to trace the structure of a codebase. Begin with a local
          repository when import becomes available in M1.
        </p>
      </div>
      <section className="workspace" aria-label="Graph workspace">
        <div className="workspace-toolbar">
          <span>
            Visualization space{" "}
            <span className="toolbar-caption">/ Awaiting repository</span>
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
            <h2>No repository loaded.</h2>
            <p>
              Nothing to map yet. Repository selection arrives in M1; actual
              file relationships and graph views follow in later milestones.
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
