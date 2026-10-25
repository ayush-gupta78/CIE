import { useCallback, useEffect, useRef, useState } from "react";
import {
  ApiError,
  closeRepository,
  directoryPage,
  rescanRepository,
  selectRepository,
  type Entry,
  type Page,
  type Selection,
} from "./repositoryApi";
import type { Connection } from "./useLocalHealth";

type Listing = {
  entries: Entry[];
  nextCursor: string | null;
  loading: boolean;
  error?: string;
};
type Props = {
  repository: Selection | null | undefined;
  connection: Connection;
  onChange: (repository: Selection | null) => void;
  onSelectFile: (entry: Entry) => void;
  onStale: () => void;
  startupError?: string;
};

function DirectoryTree({
  repository,
  onSelectFile,
  onStale,
}: {
  repository: Selection;
  onSelectFile: (entry: Entry) => void;
  onStale: () => void;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const expandedRef = useRef(expanded);
  expandedRef.current = expanded;
  const [pages, setPages] = useState<Record<string, Listing>>({});
  const controllers = useRef(new Set<AbortController>());
  const generation = useRef(0);
  const load = useCallback(
    async (
      dir: string,
      cursor?: string,
      generationAtStart = generation.current,
    ) => {
      const controller = new AbortController();
      controllers.current.add(controller);
      setPages((old) => ({
        ...old,
        [dir]: {
          entries: cursor ? (old[dir]?.entries ?? []) : [],
          nextCursor: cursor ? (old[dir]?.nextCursor ?? null) : null,
          loading: true,
        },
      }));
      try {
        const result: Page = await directoryPage(
          repository,
          dir,
          cursor,
          controller.signal,
        );
        if (generationAtStart !== generation.current) return;
        setPages((old) => {
          const previous = cursor ? (old[dir]?.entries ?? []) : [];
          const seen = new Set(previous.map((e) => e.path));
          return {
            ...old,
            [dir]: {
              entries: [
                ...previous,
                ...result.entries.filter((e) => !seen.has(e.path)),
              ],
              nextCursor: result.nextCursor,
              loading: false,
            },
          };
        });
      } catch (error) {
        if (
          generationAtStart !== generation.current ||
          controller.signal.aborted
        )
          return;
        if (error instanceof ApiError && error.code === "STALE_REPOSITORY")
          onStale();
        setPages((old) => ({
          ...old,
          [dir]: {
            entries: old[dir]?.entries ?? [],
            nextCursor: old[dir]?.nextCursor ?? null,
            loading: false,
            error:
              error instanceof Error ? error.message : "Directory unavailable.",
          },
        }));
      } finally {
        controllers.current.delete(controller);
      }
    },
    [repository, onStale],
  );

  useEffect(() => {
    const next = ++generation.current;
    for (const controller of controllers.current) controller.abort();
    controllers.current.clear();
    setPages({});
    void load(".", undefined, next);
    for (const dir of expandedRef.current) void load(dir, undefined, next);
    return () => {
      generation.current++;
      for (const controller of controllers.current) controller.abort();
      controllers.current.clear();
    };
  }, [repository, load]);

  function toggle(dir: string) {
    if (expanded.has(dir)) {
      setExpanded((old) => {
        const next = new Set(old);
        next.delete(dir);
        return next;
      });
      return;
    }
    setExpanded((old) => new Set(old).add(dir));
    if (!pages[dir]) void load(dir);
  }
  function rows(dir: string, depth: number): React.ReactNode {
    const listing = pages[dir];
    if (!listing)
      return (
        <p className="tree-message" role="status">
          Loading directory…
        </p>
      );
    return (
      <>
        {listing.error && (
          <p className="tree-error" role="alert">
            {listing.error}{" "}
            <button
              type="button"
              className="inline-button"
              onClick={() => void load(dir)}
            >
              Retry directory
            </button>
          </p>
        )}
        {listing.entries.length === 0 && !listing.loading && !listing.error && (
          <p className="tree-message">This directory has no visible files.</p>
        )}
        {listing.entries.map((item) => (
          <div key={item.path}>
            {item.kind === "directory" ? (
              <button
                type="button"
                className="tree-row"
                style={{ paddingLeft: `${depth * 17 + 12}px` }}
                aria-label={`${item.name} ${expanded.has(item.path) ? "Collapse" : "Expand"}`}
                aria-expanded={expanded.has(item.path)}
                title={item.path}
                onClick={() => toggle(item.path)}
              >
                <span className="tree-chevron" aria-hidden="true">
                  {expanded.has(item.path) ? "▾" : "▸"}
                </span>
                <span className="tree-name">{item.name}</span>
                <span className="tree-kind">Folder</span>
              </button>
            ) : (
              <button
                type="button"
                className="tree-row"
                style={{ paddingLeft: `${depth * 17 + 12}px` }}
                title={item.path}
                onClick={() => onSelectFile(item)}
              >
                <span className="tree-chevron" aria-hidden="true">
                  ·
                </span>
                <span className="tree-name">{item.name}</span>
                <span className="tree-kind">
                  {item.sizeBytes?.toLocaleString()} B
                </span>
              </button>
            )}
            {item.kind === "directory" && expanded.has(item.path) && (
              <div className="tree-children">{rows(item.path, depth + 1)}</div>
            )}
          </div>
        ))}
        {listing.loading && (
          <p className="tree-message" role="status">
            Loading directory…
          </p>
        )}
        {listing.nextCursor && (
          <button
            type="button"
            className="load-more"
            disabled={listing.loading}
            onClick={() => void load(dir, listing.nextCursor!)}
          >
            Load more
          </button>
        )}
      </>
    );
  }
  return (
    <section className="tree-panel" aria-label="Repository files">
      <div className="tree-header">
        <span>Files in {repository.rootName}</span>
        <span>Directory listing · no graph data</span>
      </div>
      {rows(".", 0)}
      <p className="tree-note">
        Ignored files and generated folders are hidden. Expand folders to load
        their contents.
      </p>
    </section>
  );
}

export function RepositoryPage({
  repository,
  connection,
  onChange,
  onSelectFile,
  onStale,
  startupError,
}: Props) {
  const [path, setPath] = useState("");
  const [changing, setChanging] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const controller = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      controller.current?.abort();
    },
    [],
  );
  async function act(
    operation: (signal: AbortSignal) => Promise<Selection | null>,
  ) {
    controller.current?.abort();
    const next = new AbortController();
    controller.current = next;
    setPending(true);
    setError("");
    try {
      const result = await operation(next.signal);
      if (controller.current !== next) return;
      onChange(result);
      setChanging(false);
      setPath("");
    } catch (issue) {
      if (!next.signal.aborted)
        setError(
          issue instanceof Error ? issue.message : "Local request failed.",
        );
    } finally {
      if (controller.current === next) {
        controller.current = null;
        setPending(false);
      }
    }
  }
  const showForm = !repository || changing;
  return (
    <section className="repository-page" aria-labelledby="repository-title">
      <p className="kicker">Local exploration</p>
      <h1 id="repository-title">Explore a local codebase.</h1>
      <p className="intro-copy">
        Browse real files and folders here. Open Graph to analyze supported
        source files and explore verified dependencies in 3D.
      </p>
      {showForm && (
        <form
          className="repository-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (path.trim())
              void act((signal) => selectRepository(path.trim(), signal));
            else setError("Enter an absolute local directory path.");
          }}
        >
          <label htmlFor="repo-path">Local directory path</label>
          <p>
            Enter an absolute path on this computer. Browsers do not reveal full
            paths through a normal folder picker; the local server opens only
            the folder you choose.
          </p>
          <div className="path-controls">
            <input
              id="repo-path"
              value={path}
              onChange={(event) => setPath(event.target.value)}
              autoComplete="off"
              spellCheck={false}
              placeholder="/path/to/project"
              disabled={pending}
            />
            <button
              type="submit"
              disabled={pending || connection !== "connected"}
            >
              {pending ? "Opening…" : "Open repository"}
            </button>
          </div>
          {connection === "disconnected" && (
            <p className="tree-error" role="alert">
              Local API is offline. Retry connection before opening a directory.
            </p>
          )}
          {repository && changing && (
            <button
              type="button"
              className="inline-button"
              onClick={() => {
                setChanging(false);
                setError("");
              }}
            >
              Cancel change
            </button>
          )}
        </form>
      )}
      {repository === undefined && (
        <p className="tree-message" role="status">
          Checking current repository…
        </p>
      )}
      {startupError && (
        <p className="tree-error" role="alert">
          {startupError}
        </p>
      )}
      {error && (
        <p className="tree-error" role="alert">
          {error}
        </p>
      )}
      {repository && (
        <>
          <div className="repo-actions">
            <div>
              <strong title={repository.rootName}>{repository.rootName}</strong>
              <span>Selected on this device</span>
            </div>
            <button
              type="button"
              disabled={pending || connection !== "connected"}
              onClick={() => setChanging(true)}
            >
              Change repository
            </button>
            <button
              type="button"
              disabled={pending || connection !== "connected"}
              onClick={() => void act((signal) => rescanRepository(signal))}
            >
              {pending ? "Refreshing…" : "Refresh"}
            </button>
            <button
              type="button"
              disabled={pending || connection !== "connected"}
              onClick={() =>
                void act(async (signal) => {
                  await closeRepository(signal);
                  return null;
                })
              }
            >
              Close repository
            </button>
          </div>
          <DirectoryTree
            key={repository.repositoryId}
            repository={repository}
            onSelectFile={onSelectFile}
            onStale={onStale}
          />
        </>
      )}
      {!repository &&
        repository !== undefined &&
        connection === "connected" && (
          <p className="tree-note">
            No repository selected. Nothing is scanned until you open a
            directory.
          </p>
        )}
    </section>
  );
}
