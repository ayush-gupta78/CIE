import type { Selection } from "./repositoryApi";
import { Crest } from "./Crest";

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
    <section className="archive-landing" aria-labelledby="archive-title">
      <div className="archive-art" aria-hidden="true" />
      <div className="archive-hero">
        <div className="archive-hero-line" aria-hidden="true">
          <Crest />
        </div>
        <h1 id="archive-title">
          The architecture
          <br />
          behind the code.
        </h1>
        <p className="archive-hero-subtitle">
          CIE / AI Codebase Intelligence Engine
        </p>
        <p className="archive-hero-mission">
          Open a local repository. Follow the verified paths between its files.
        </p>
      </div>
      <div className="archive-actions" aria-label="Begin exploring">
        <button
          type="button"
          className="archive-action-card archive-action-open"
          onClick={onOpenRepository}
        >
          <span className="archive-action-icon" aria-hidden="true">
            <Crest />
          </span>
          <strong>
            Open Local
            <br />
            Repository
          </strong>
          <span>Select a folder on this device for private exploration.</span>
          <span className="archive-action-arrow" aria-hidden="true" />
        </button>
        <button
          type="button"
          className="archive-action-card archive-action-resume"
          onClick={onOpenGraph}
          disabled={!repository}
          title={
            repository
              ? "Continue exploring the selected repository"
              : "Select a repository first"
          }
        >
          <span className="archive-action-icon" aria-hidden="true">
            <Crest />
          </span>
          <strong>
            Continue
            <br />
            Current Session
          </strong>
          <span>
            {repository
              ? `Explore ${repository.rootName} in the 3D atlas.`
              : "Select a repository to continue."}
          </span>
          <span className="archive-action-arrow" aria-hidden="true" />
        </button>
        <button
          type="button"
          className="archive-action-card archive-action-deferred"
          disabled
          title="Analysis snapshot import is not available yet"
          aria-label="Import analysis snapshot, not available yet"
        >
          <span className="archive-action-icon" aria-hidden="true">
            <Crest />
          </span>
          <strong>
            Import Analysis
            <br />
            Snapshot
          </strong>
          <span>Not available in this local release.</span>
          <span className="archive-action-arrow" aria-hidden="true" />
        </button>
      </div>
      <aside className="archive-current" aria-label="Current repository">
        <div className="archive-current-heading">
          <span>Current repository</span>
          <Crest />
        </div>
        {repository ? (
          <>
            <div className="archive-current-art" aria-hidden="true" />
            <h2>{repository.rootName}</h2>
            <p>Selected on this device · revision {repository.revision}</p>
            <div className="archive-current-rule" />
            <button type="button" onClick={onOpenGraph}>
              Enter the 3D atlas
            </button>
          </>
        ) : (
          <>
            <Crest className="archive-current-empty-crest" />
            <h2>
              {repository === undefined
                ? "Checking local selection"
                : "No repository selected"}
            </h2>
            <p>
              Nothing is scanned until you choose a local folder. Recent-project
              history is not stored.
            </p>
            <button type="button" onClick={onOpenRepository}>
              Choose a repository
            </button>
          </>
        )}
      </aside>
      <div className="archive-landing-foot">
        Local by default <span aria-hidden="true" /> Verified file relationships{" "}
        <span aria-hidden="true" /> No source upload
      </div>
    </section>
  );
}
