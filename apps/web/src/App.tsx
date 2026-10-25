import { useState } from "react";
import { useLocalHealth } from "./useLocalHealth";
import { Workspace } from "./Workspace";
import { Settings } from "./Settings";

type Page = "workspace" | "settings";

const future = [
  { label: "Repository", milestone: "M1" },
  { label: "Graph", milestone: "M3" },
  { label: "Insights", milestone: "M5" },
  { label: "AI", milestone: "M7" },
];

export function App() {
  const [page, setPage] = useState<Page>("workspace");
  const { connection, version, check } = useLocalHealth();

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
            <Workspace />
          ) : (
            <Settings
              version={version}
              statusText={statusText}
              connection={connection}
              check={check}
            />
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
