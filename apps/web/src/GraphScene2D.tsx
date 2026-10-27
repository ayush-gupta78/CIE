import { useEffect, useMemo, useRef, useState } from "react";
import { groupColor, type SceneModel } from "./graphModel";
import {
  frameBox,
  layoutGraph2D,
  type Box,
  type Point2D,
} from "./graphLayout2D";

type View = { x: number; y: number; scale: number };
export function GraphScene2D({
  model,
  selectedId,
  search,
  onSelect,
  focusId,
  focusModule,
  focusToken,
  fitToken,
  active,
}: {
  model: SceneModel;
  selectedId: string | null;
  search: string;
  onSelect: (id: string) => void;
  focusId: string | null;
  focusModule: string | null;
  focusToken: number;
  fitToken: number;
  active: boolean;
}) {
  const layout = useMemo(() => layoutGraph2D(model), [model]);
  const ref = useRef<SVGSVGElement>(null);
  const gesture = useRef({
    pointers: new Map<
      number,
      { x: number; y: number; startX: number; startY: number }
    >(),
    moved: false,
    suppressBackgroundClick: false,
  });
  const [hoverId, setHoverId] = useState<string | null>(null);
  const lastFit = useRef<number | null>(null);
  const lastSize = useRef("");
  const lastFocus = useRef(0);
  const [size, setSize] = useState({ width: 800, height: 500 });
  const [view, setView] = useState<View>({ x: 0, y: 0, scale: 1 });
  useEffect(() => {
    if (!ref.current || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0) setSize({ width, height });
    });
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  const { width, height } = size;
  useEffect(() => {
    const resized = lastSize.current !== `${width}:${height}`;
    if (active && (lastFit.current !== fitToken || resized)) {
      setView(frameBox(layout.bounds, width, height));
      lastFit.current = fitToken;
      lastSize.current = `${width}:${height}`;
      if (resized) lastFocus.current = 0;
    }
  }, [layout, fitToken, active, width, height]);
  useEffect(() => {
    if (!active || !focusToken || lastFocus.current === focusToken) return;
    const point = focusId ? layout.nodes.get(focusId) : null;
    const ids = focusModule
      ? model.files
          .filter(
            (file) =>
              focusModule === "." ||
              file.parent === focusModule ||
              file.parent.startsWith(`${focusModule}/`),
          )
          .map((file) => file.id)
      : [];
    let box: Box | null = null;
    if (point && focusId) {
      let radiusX = 32;
      let radiusY = 32;
      const neighbors = [
        ...(model.outgoing.get(focusId) ?? []).flatMap((edge) =>
          edge.to ? [edge.to] : [],
        ),
        ...(model.incoming.get(focusId) ?? []).map((edge) => edge.from),
      ];
      for (const id of neighbors) {
        const item = layout.nodes.get(id);
        if (!item) continue;
        radiusX = Math.max(radiusX, Math.abs(item.x - point.x) + 24);
        radiusY = Math.max(radiusY, Math.abs(item.y - point.y) + 24);
      }
      box = {
        x: point.x - radiusX - 28,
        y: point.y - radiusY - 28,
        width: radiusX * 2 + 56,
        height: radiusY * 2 + 56,
      };
    } else if (ids.length) {
      const points = ids.map((id) => layout.nodes.get(id)!);
      const minX = Math.min(...points.map((entry) => entry.x));
      const minY = Math.min(...points.map((entry) => entry.y));
      box = {
        x: minX - 55,
        y: minY - 55,
        width: Math.max(...points.map((entry) => entry.x)) - minX + 110,
        height: Math.max(...points.map((entry) => entry.y)) - minY + 110,
      };
    }
    if (box) {
      setView(frameBox(box, width, height, focusId ? 1.7 : 1.5));
      lastFocus.current = focusToken;
    }
  }, [focusId, focusModule, focusToken, layout, model, width, height, active]);
  const zoom = (factor: number, px = width / 2, py = height / 2) =>
    setView((old) => {
      const scale = Math.max(0.0001, Math.min(3, old.scale * factor));
      return {
        scale,
        x: px - ((px - old.x) * scale) / old.scale,
        y: py - ((py - old.y) * scale) / old.scale,
      };
    });
  const point = (event: React.PointerEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };
  const fileById = new Map(model.files.map((file) => [file.id, file]));
  const query = search.trim().toLocaleLowerCase();
  const matches = new Set(
    model.files
      .filter((file) => query && file.path.toLocaleLowerCase().includes(query))
      .map((file) => file.id),
  );
  const directions = new Set(
    model.connections.map((edge) => `${edge.from}\0${edge.to}`),
  );
  const screenPoint = (point: Point2D) => ({
    x: point.x * view.scale + view.x,
    y: point.y * view.scale + view.y,
  });
  const selectedPosition = selectedId && layout.nodes.get(selectedId);
  const selectedScreen = selectedPosition && screenPoint(selectedPosition);
  const selectedVisible = !!(
    selectedScreen &&
    selectedScreen.x >= 0 &&
    selectedScreen.x <= width &&
    selectedScreen.y >= 0 &&
    selectedScreen.y <= height
  );
  const labels = useMemo(() => {
    const visible = new Set<string>();
    const occupied: Box[] = [];
    const candidates = [...model.files].sort((a, b) => {
      const priority = (file: typeof a) =>
        Number(file.id === selectedId) * 1000 +
        Number(!!query && file.path.toLocaleLowerCase().includes(query)) * 500 +
        (model.incoming.get(file.id)?.length ?? 0) +
        (model.outgoing.get(file.id)?.length ?? 0);
      return priority(b) - priority(a) || a.path.localeCompare(b.path, "en");
    });
    for (const file of candidates) {
      if (selectedVisible && file.id === selectedId) continue;
      if (
        selectedVisible &&
        selectedId &&
        file.id !== selectedId &&
        !(model.incoming.get(selectedId) ?? []).some(
          (edge) => edge.from === file.id,
        ) &&
        !(model.outgoing.get(selectedId) ?? []).some(
          (edge) => edge.to === file.id,
        ) &&
        !file.path.toLocaleLowerCase().includes(query || "\0")
      )
        continue;
      if (
        view.scale < 0.68 &&
        !file.path.toLocaleLowerCase().includes(query || "\0")
      )
        continue;
      if (visible.size >= 24) break;
      const position = layout.nodes.get(file.id)!;
      const box = {
        x: position.x + 12,
        y: position.y - 24,
        width: Math.min(27, file.name.length) * 7 + 12,
        height: 17,
      };
      if (
        occupied.some(
          (other) =>
            box.x < other.x + other.width &&
            box.x + box.width > other.x &&
            box.y < other.y + other.height &&
            box.y + box.height > other.y,
        )
      )
        continue;
      occupied.push(box);
      visible.add(file.id);
    }
    return visible;
  }, [layout, model, selectedId, selectedVisible, query, view.scale]);
  const selectedFile = selectedId ? fileById.get(selectedId) : null;
  const hoveredFile =
    hoverId && hoverId !== selectedId ? fileById.get(hoverId) : null;
  const pin = (id: string, cardWidth: number, cardHeight: number) => {
    const position = screenPoint(layout.nodes.get(id)!);
    return {
      left: Math.max(8, Math.min(width - cardWidth - 8, position.x + 15)),
      top: Math.max(
        8,
        Math.min(height - cardHeight - 8, position.y - cardHeight - 20),
      ),
    };
  };
  const clusterLabels: {
    path: string;
    x: number;
    y: number;
    color: string;
    count: number;
  }[] = [];
  for (const group of [...layout.groups].sort(
    (a, b) => b.count - a.count || a.path.localeCompare(b.path, "en"),
  )) {
    if (selectedId && group.path !== focusModule) continue;
    const position = screenPoint({
      x: group.x,
      y: group.y - group.radius * 0.6,
    });
    if (
      clusterLabels.length >= 8 ||
      position.x < 8 ||
      position.x > width - 110 ||
      position.y < 28 ||
      position.y > height - 24
    )
      continue;
    if (
      clusterLabels.some(
        (other) => Math.hypot(other.x - position.x, other.y - position.y) < 110,
      )
    )
      continue;
    clusterLabels.push({
      path: group.path,
      x: position.x,
      y: position.y,
      color: group.color,
      count: group.count,
    });
  }
  return (
    <div className="graph-2d" aria-label="Interactive 2D file connectivity map">
      <svg
        ref={ref}
        role="group"
        aria-label={`${model.files.length} file map with verified directed dependencies`}
        onWheel={(event) => {
          event.preventDefault();
          const rect = event.currentTarget.getBoundingClientRect();
          zoom(
            Math.exp(-event.deltaY * 0.001),
            event.clientX - rect.left,
            event.clientY - rect.top,
          );
        }}
        onPointerDown={(event) => {
          if (event.target !== event.currentTarget) return;
          const next = point(event);
          gesture.current.pointers.set(event.pointerId, {
            ...next,
            startX: next.x,
            startY: next.y,
          });
          gesture.current.suppressBackgroundClick = false;
          if (gesture.current.pointers.size > 1) gesture.current.moved = true;
          event.currentTarget.setPointerCapture?.(event.pointerId);
        }}
        onPointerMove={(event) => {
          const previous = gesture.current.pointers.get(event.pointerId);
          if (!previous) return;
          const next = point(event);
          const others = [...gesture.current.pointers].filter(
            ([id]) => id !== event.pointerId,
          );
          if (others.length) {
            const other = others[0][1];
            const before = Math.hypot(
              previous.x - other.x,
              previous.y - other.y,
            );
            const after = Math.hypot(next.x - other.x, next.y - other.y);
            if (before > 0)
              zoom(
                after / before,
                (next.x + other.x) / 2,
                (next.y + other.y) / 2,
              );
            gesture.current.moved = true;
          } else {
            if (
              Math.hypot(next.x - previous.startX, next.y - previous.startY) > 5
            )
              gesture.current.moved = true;
            if (gesture.current.moved)
              setView((old) => ({
                ...old,
                x: old.x + next.x - previous.x,
                y: old.y + next.y - previous.y,
              }));
          }
          gesture.current.pointers.set(event.pointerId, {
            ...previous,
            ...next,
          });
        }}
        onPointerUp={(event) => {
          gesture.current.pointers.delete(event.pointerId);
          if (!gesture.current.pointers.size) {
            gesture.current.suppressBackgroundClick = gesture.current.moved;
            gesture.current.moved = false;
          }
          if (event.currentTarget.hasPointerCapture?.(event.pointerId))
            event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        onPointerCancel={(event) => {
          gesture.current.pointers.delete(event.pointerId);
          gesture.current.moved = false;
          gesture.current.suppressBackgroundClick = false;
          if (event.currentTarget.hasPointerCapture?.(event.pointerId))
            event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        onClick={() => {
          // Background clicks retain selection; Escape and Clear selection are explicit.
          gesture.current.suppressBackgroundClick = false;
        }}
      >
        <g transform={`translate(${view.x} ${view.y}) scale(${view.scale})`}>
          {model.files.length === 0 && (
            <text className="graph-2d-empty" x="-120" y="0">
              No eligible files in this repository.
            </text>
          )}
          {[...model.connections]
            .sort((a, b) => {
              const related = (edge: typeof a) =>
                Number(edge.from === selectedId || edge.to === selectedId);
              return (
                related(a) - related(b) ||
                a.from.localeCompare(b.from, "en") ||
                a.to.localeCompare(b.to, "en") ||
                a.kind.localeCompare(b.kind, "en")
              );
            })
            .map((connection) => {
              const source = layout.nodes.get(connection.from);
              const target = layout.nodes.get(connection.to);
              if (
                !source ||
                !target ||
                !connection.edges.some(
                  (edge) =>
                    edge.resolution === "resolved_static" &&
                    edge.to === connection.to,
                )
              )
                return null;
              const outgoing =
                selectedVisible && selectedId === connection.from;
              const incoming = selectedVisible && selectedId === connection.to;
              const color = outgoing
                ? "#f0c98b"
                : incoming
                  ? "#87b7ee"
                  : "#72808b";
              const dx = target.x - source.x;
              const dy = target.y - source.y;
              const distance = Math.hypot(dx, dy);
              const reciprocal = directions.has(
                `${connection.to}\0${connection.from}`,
              );
              const ux = dx / (distance || 1);
              const uy = dy / (distance || 1);
              const bend = reciprocal ? 18 : 0;
              const nx = -uy * bend;
              const ny = ux * bend;
              const d =
                distance < 1
                  ? `M ${source.x + 8} ${source.y - 8} C ${source.x + 52} ${source.y - 58} ${source.x - 52} ${source.y - 58} ${source.x - 8} ${source.y - 8}`
                  : `M ${source.x + ux * 12} ${source.y + uy * 12} Q ${(source.x + target.x) / 2 + nx} ${(source.y + target.y) / 2 + ny} ${target.x - ux * 15} ${target.y - uy * 15}`;
              return (
                <path
                  key={`${connection.from}:${connection.to}:${connection.kind}`}
                  className={`graph-2d-edge ${outgoing || incoming ? "active" : selectedVisible ? "dim" : ""}`}
                  d={d}
                  stroke={color}
                  markerEnd={
                    outgoing
                      ? "url(#arrow-out)"
                      : incoming
                        ? "url(#arrow-in)"
                        : "url(#arrow-default)"
                  }
                >
                  <title>
                    {fileById.get(connection.from)?.path} →{" "}
                    {fileById.get(connection.to)?.path} · {connection.count}{" "}
                    verified declaration(s)
                  </title>
                </path>
              );
            })}
          {model.files.map((file) => {
            const position = layout.nodes.get(file.id)!;
            const selected = file.id === selectedId;
            const outgoing =
              selectedVisible &&
              model.outgoing
                .get(selectedId ?? "")
                ?.some((edge) => edge.to === file.id);
            const incoming =
              selectedVisible &&
              model.incoming
                .get(selectedId ?? "")
                ?.some((edge) => edge.from === file.id);
            const both = outgoing && incoming;
            return (
              <g
                key={file.id}
                role="button"
                tabIndex={0}
                aria-label={file.path}
                aria-pressed={selected}
                className={`graph-2d-file ${selected ? "selected" : both ? "both" : outgoing ? "outgoing" : incoming ? "incoming" : ""} ${matches.has(file.id) ? "search-match" : ""} ${selectedVisible && !selected && !outgoing && !incoming ? "dim" : ""} ${file.status === "unsupported" || file.status === "skipped" ? "unsupported" : ""}`}
                onClick={(event) => {
                  event.stopPropagation();
                  onSelect(file.id);
                }}
                onPointerEnter={() => setHoverId(file.id)}
                onPointerLeave={() =>
                  setHoverId((old) => (old === file.id ? null : old))
                }
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onSelect(file.id);
                  }
                }}
              >
                <title>
                  {file.path} · {file.status} dependency analysis ·{" "}
                  {model.outgoing.get(file.id)?.length ?? 0} outgoing ·{" "}
                  {model.incoming.get(file.id)?.length ?? 0} incoming
                </title>
                <circle
                  className="graph-2d-hit"
                  cx={position.x}
                  cy={position.y}
                  r="22"
                />
                <circle
                  className="graph-2d-ring"
                  cx={position.x}
                  cy={position.y}
                  r={selected ? 13 : 10}
                />
                {both && (
                  <circle
                    className="graph-2d-both-ring"
                    cx={position.x}
                    cy={position.y}
                    r="14"
                  />
                )}
                <circle
                  className="graph-2d-dot"
                  cx={position.x}
                  cy={position.y}
                  r={selected ? 9 : hoverId === file.id ? 8 : 6}
                  style={{
                    fill: selected ? undefined : groupColor(file.parent),
                  }}
                />
                {selected && (
                  <circle
                    className="graph-2d-core"
                    cx={position.x}
                    cy={position.y}
                    r="3"
                  />
                )}
                {labels.has(file.id) && (
                  <text x={position.x + 13} y={position.y - 11}>
                    {file.name.length > 27
                      ? `${file.name.slice(0, 25)}…`
                      : file.name}
                  </text>
                )}
              </g>
            );
          })}
        </g>
        <defs>
          {[
            ["arrow-default", "#72808b"],
            ["arrow-out", "#f0c98b"],
            ["arrow-in", "#87b7ee"],
          ].map(([id, color]) => (
            <marker
              key={id}
              id={id}
              markerWidth="9"
              markerHeight="9"
              refX="7"
              refY="4.5"
              orient="auto"
              markerUnits="userSpaceOnUse"
            >
              <path d="M 0 0 L 9 4.5 L 0 9 Z" fill={color} />
            </marker>
          ))}
        </defs>
      </svg>
      <div className="graph-2d-clusters" aria-label="Mapped directory clusters">
        {clusterLabels.map((group) => (
          <span
            key={group.path}
            title={group.path}
            style={{ left: group.x, top: group.y, color: group.color }}
          >
            {group.path === "." ? "root" : group.path}{" "}
            <small>{group.count}</small>
          </span>
        ))}
      </div>
      {query && (
        <span className="graph-2d-search-summary">
          {matches.size} matching file{matches.size === 1 ? "" : "s"} · full
          paths in Files
        </span>
      )}
      {selectedFile && selectedVisible && (
        <div
          className="graph-2d-selected-name"
          style={pin(selectedFile.id, 220, 52)}
          title={selectedFile.path}
        >
          <strong>{selectedFile.name}</strong>
          <small>{selectedFile.path}</small>
        </div>
      )}
      {hoveredFile && (
        <div
          className="graph-2d-tooltip"
          role="tooltip"
          style={pin(hoveredFile.id, 230, 94)}
        >
          <strong>{hoveredFile.name}</strong>
          <span>{hoveredFile.path}</span>
          <small>
            {hoveredFile.status} analysis ·{" "}
            {model.outgoing.get(hoveredFile.id)?.length ?? 0} outgoing ·{" "}
            {model.incoming.get(hoveredFile.id)?.length ?? 0} incoming
          </small>
        </div>
      )}
      <span className="graph-2d-scale">
        {Math.round(view.scale * 100)}% · Drag empty space to pan
      </span>
      <div className="graph-2d-zoom" aria-label="2D zoom controls">
        <button type="button" aria-label="Zoom in" onClick={() => zoom(1.3)}>
          +
        </button>
        <button
          type="button"
          aria-label="Zoom out"
          onClick={() => zoom(1 / 1.3)}
        >
          −
        </button>
      </div>
    </div>
  );
}
