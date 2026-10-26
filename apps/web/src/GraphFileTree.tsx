import { useEffect, useMemo, useState } from "react";
import type { FileNode } from "./graphApi";
import { groupColor } from "./graphModel";

type Directory = {
  path: string;
  children: Directory[];
  files: FileNode[];
  count: number;
};

export function buildFileTree(files: FileNode[]): Directory {
  const root: Directory = { path: ".", children: [], files: [], count: 0 };
  const nodes = new Map([[".", root]]);
  for (const file of [...files].sort((a, b) =>
    a.path.localeCompare(b.path, "en"),
  )) {
    let parent = root;
    for (const part of file.parent === "." ? [] : file.parent.split("/")) {
      const path = parent.path === "." ? part : `${parent.path}/${part}`;
      let next = nodes.get(path);
      if (!next) {
        next = { path, children: [], files: [], count: 0 };
        nodes.set(path, next);
        parent.children.push(next);
      }
      parent = next;
      parent.count++;
    }
    parent.files.push(file);
    root.count++;
  }
  return root;
}

export function GraphFileTree({
  files,
  search,
  selectedId,
  onSelect,
  onFocusModule,
}: {
  files: FileNode[];
  search: string;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onFocusModule: (path: string) => void;
}) {
  const root = useMemo(() => buildFileTree(files), [files]);
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    const paths = new Set<string>();
    let node = root;
    for (let depth = 0; depth < 3 && node.children.length; depth++) {
      node = [...node.children].sort(
        (a, b) => b.count - a.count || a.path.localeCompare(b.path),
      )[0];
      paths.add(node.path);
    }
    return paths;
  });
  useEffect(() => {
    if (!selectedId) return;
    const file = files.find((item) => item.id === selectedId);
    if (!file) return;
    const paths = file.parent === "." ? [] : file.parent.split("/");
    setExpanded((old) => {
      const next = new Set(old);
      paths.forEach((_, i) => next.add(paths.slice(0, i + 1).join("/")));
      return next;
    });
  }, [selectedId, files]);
  const query = search.trim().toLocaleLowerCase();
  const matches = (node: Directory): boolean =>
    !query ||
    node.files.some((file) => file.path.toLocaleLowerCase().includes(query)) ||
    node.children.some(matches);
  const render = (node: Directory): React.ReactNode => (
    <ul
      className="graph-tree-list"
      aria-label={node.path === "." ? "Graph files" : undefined}
    >
      {node.children.filter(matches).map((child) => {
        const open = !!query || expanded.has(child.path);
        return (
          <li key={child.path}>
            <div className="graph-directory-row">
              <button
                type="button"
                aria-expanded={open}
                aria-label={`${open ? "Collapse" : "Expand"} ${child.path}`}
                title={child.path}
                onClick={() =>
                  setExpanded((old) => {
                    const next = new Set(old);
                    if (next.has(child.path)) next.delete(child.path);
                    else next.add(child.path);
                    return next;
                  })
                }
              >
                <span
                  className={`atlas-tree-chevron ${open ? "open" : ""}`}
                  aria-hidden="true"
                />
                <span
                  className="graph-group-dot"
                  style={{ backgroundColor: groupColor(child.path) }}
                />
                {child.path.split("/").at(-1)} <small>{child.count}</small>
              </button>
              <button
                className="graph-module-focus"
                type="button"
                title={`Focus ${child.path}`}
                aria-label={`Focus module ${child.path}`}
                onClick={() => onFocusModule(child.path)}
              >
                <span className="atlas-focus-target" aria-hidden="true" />
              </button>
            </div>
            {open && render(child)}
          </li>
        );
      })}
      {node.files
        .filter(
          (file) => !query || file.path.toLocaleLowerCase().includes(query),
        )
        .map((file) => (
          <li key={file.id}>
            <button
              type="button"
              title={file.path}
              className={`graph-file-button ${file.id === selectedId ? "selected" : ""}`}
              aria-pressed={file.id === selectedId}
              aria-label={file.path}
              onClick={() => onSelect(file.id)}
            >
              <span>
                <span className="atlas-file-symbol" aria-hidden="true" />{" "}
                {file.name}
              </span>
              {node.path === "." && <small>{file.path}</small>}
              {file.status === "failed" && <em>Parse failed</em>}
            </button>
          </li>
        ))}
    </ul>
  );
  return render(root);
}
