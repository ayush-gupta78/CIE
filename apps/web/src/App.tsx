import { useCallback, useEffect, useState } from "react";

type Connection = "checking" | "connected" | "disconnected";
type Page = "workspace" | "settings";

const future = [
  { label: "Repository", milestone: "M1" },
  { label: "Graph", milestone: "M3" },
  { label: "Insights", milestone: "M5" },
  { label: "AI", milestone: "M7" },
];

export function App() {
  const [page, setPage] = useState<Page>("workspace");
  const [connection, setConnection] = useState<Connection>("checking");
  const [version, setVersion] = useState("0.1.0");

  const check = useCallback(async () => {
    setConnection("checking");
    try {
      const response = await fetch("/api/v1/health", {
        cache: "no-store",
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) throw new Error("Health request failed");
      const data: unknown = await response.json();
      if (
        !data ||
        typeof data !== "object" ||
        !("status" in data) ||
        data.status !== "ok" ||
        !("mode" in data) ||
        data.mode !== "local" ||
        !("version" in data) ||
        typeof data.version !== "string"
      )
        throw new Error("Invalid health response");
      setVersion(data.version);
      setConnection("connected");
    } catch {
      setConnection("disconnected");
    }
  }, []);

  useEffect(() => {
    void check();
    const interval = window.setInterval(() => void check(), 30_000);
    return () => window.clearInterval(interval);
  }, [check]);

  const statusText =
    connection === "connected"
      ? "Connected"
      : connection === "checking"
        ? "Checking"
        : "Disconnected";

  return (
    <div className="shell">
      <header className="topbar">
        <div
          className="brand"
          aria-label="CIE, AI Codebase Intelligence Engine"
        >
          <span className="brand-mark">CIE</span>
          <span className="brand-name">Codebase intelligence</span>
        </div>
        <span className="repository-label">No repository selected</span>
        <div className="top-actions">
          <span className="mode-label">Local mode</span>
          <span
            className={`connection ${connection}`}
            role="status"
            aria-live="polite"
          >
            <span className="status-dot" aria-hidden="true" />
            {statusText}
          </span>
          <button
            className="top-settings"
            type="button"
            onClick={() => setPage("settings")}
          >
            Settings
          </button>
        </div>
      </header>

      <div className="layout">
        <nav className="sidebar" aria-label="Primary navigation">
          <div className="nav-heading">Navigate</div>
          <button
            type="button"
            className={`nav-item ${page === "workspace" ? "active" : ""}`}
            aria-current={page === "workspace" ? "page" : undefined}
            onClick={() => setPage("workspace")}
          >
            Workspace
          </button>
          {future.map(({ label, milestone }) => (
            <button
              type="button"
              className="nav-item future"
              key={label}
              disabled
              title={`Available in ${milestone}`}
              aria-label={`${label}, available in ${milestone}`}
            >
              <span>{label}</span>
              <span className="milestone">{milestone}</span>
            </button>
          ))}
          <div className="nav-bottom">
            <button
              type="button"
              className={`nav-item ${page === "settings" ? "active" : ""}`}
              aria-current={page === "settings" ? "page" : undefined}
              onClick={() => setPage("settings")}
            >
              Settings
            </button>
            <p>
              Private by default.
              <br />
              Built for local exploration.
            </p>
          </div>
        </nav>

        <main className="main" id="main-content">
          {page === "workspace" ? (
            <>
              <div className="intro">
                <p className="kicker">Your workspace</p>
                <h1>
                  Understand how
                  <br />
                  your code connects.
                </h1>
                <p className="intro-copy">
                  A place to trace the structure of a codebase. Begin with a
                  local repository when import becomes available in M1.
                </p>
              </div>
              <section className="workspace" aria-label="Graph workspace">
                <div className="workspace-toolbar">
                  <span>
                    Visualization space{" "}
                    <span className="toolbar-caption">
                      / Awaiting repository
                    </span>
                  </span>
                  <div
                    className="view-modes"
                    role="group"
                    aria-label="View modes, not yet available"
                  >
                    <button
                      type="button"
                      disabled
                      title="3D view available in M3"
                    >
                      3D <small>M3</small>
                    </button>
                    <button
                      type="button"
                      disabled
                      title="2D view available in M4"
                    >
                      2D <small>M4</small>
                    </button>
                  </div>
                </div>
                <div className="stage">
                  <div
                    className="stage-corner stage-corner-top"
                    aria-hidden="true"
                  />
                  <div className="empty-state">
                    <div className="empty-rule" aria-hidden="true" />
                    <p className="empty-overline">An open canvas</p>
                    <h2>No repository loaded.</h2>
                    <p>
                      Nothing to map yet. Repository selection arrives in M1;
                      actual file relationships and graph views follow in later
                      milestones.
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
          ) : (
            <section className="settings-page" aria-labelledby="settings-title">
              <p className="kicker">Preferences</p>
              <h1 id="settings-title">Settings.</h1>
              <p className="intro-copy">
                A small, local foundation. Nothing is indexed or sent anywhere.
              </p>
              <dl className="settings-list">
                <div>
                  <dt>Application version</dt>
                  <dd>{version}</dd>
                </div>
                <div>
                  <dt>Privacy</dt>
                  <dd>
                    Runs on this device. No telemetry or external runtime
                    service.
                  </dd>
                </div>
                <div>
                  <dt>Motion</dt>
                  <dd>Follows your system’s reduced-motion setting.</dd>
                </div>
                <div>
                  <dt>Local API</dt>
                  <dd>
                    {statusText}.{" "}
                    <button
                      type="button"
                      className="inline-button"
                      onClick={() => void check()}
                      disabled={connection === "checking"}
                    >
                      Retry connection
                    </button>
                  </dd>
                </div>
              </dl>
            </section>
          )}
        </main>

        <aside className="inspector" aria-label="File details">
          <div className="inspector-heading">
            <span>File details</span>
            <span className="inspector-dash" aria-hidden="true">
              —
            </span>
          </div>
          <div className="inspector-empty">
            <span className="inspector-glyph" aria-hidden="true">
              ◌
            </span>
            <h2>No file selected</h2>
            <p>
              When a real file is selected in a future milestone, its details
              will appear here.
            </p>
          </div>
          <span className="inspector-footer">Awaiting a repository</span>
        </aside>
      </div>

      <footer className="statusbar">
        <span>
          Local API: <strong className={connection}>{statusText}</strong>
        </span>
        <button
          type="button"
          className="status-retry"
          onClick={() => void check()}
          disabled={connection === "checking"}
        >
          Retry connection
        </button>
        <span className="index-status">
          Index: <strong>Not started</strong>
        </span>
        <span className="status-version">CIE / {version}</span>
      </footer>
    </div>
  );
}
