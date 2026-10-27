import { useEffect, useMemo, useRef, useState } from "react";
import { groupColor, type SceneModel } from "./graphModel";
import { frameBox, layoutGraph2D, type Box } from "./graphLayout2D";

type View = { x: number; y: number; scale: number };
export function GraphScene2D({
  model,
  selectedId,
  onSelect,
  focusId,
  focusModule,
  focusToken,
  fitToken,
  active,
}: {
  model: SceneModel;
  selectedId: string | null;
  onSelect: (id: string) => void;
  focusId: string | null;
  focusModule: string | null;
  focusToken: number;
  fitToken: number;
  active: boolean;
}) {
  const layout = useMemo(() => layoutGraph2D(model), [model]);
  const ref = useRef<SVGSVGElement>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const dragged = useRef(false);
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
    let box = focusId
      ? layout.nodes.get(focusId)
      : focusModule
        ? layout.directories.get(focusModule)
        : null;
    if (focusId && box) {
      const middleX = box.x + box.width / 2;
      const middleY = box.y + box.height / 2;
      let radiusX = box.width / 2;
      let radiusY = box.height / 2;
      const neighbors = [
        ...(model.outgoing.get(focusId) ?? []).flatMap((edge) =>
          edge.to ? [edge.to] : [],
        ),
        ...(model.incoming.get(focusId) ?? []).map((edge) => edge.from),
      ];
      for (const id of neighbors) {
        const item = layout.nodes.get(id);
        if (!item) continue;
        radiusX = Math.max(
          radiusX,
          Math.abs(item.x - middleX),
          Math.abs(item.x + item.width - middleX),
        );
        radiusY = Math.max(
          radiusY,
          Math.abs(item.y - middleY),
          Math.abs(item.y + item.height - middleY),
        );
      }
      box = {
        x: middleX - radiusX - 18,
        y: middleY - radiusY - 18,
        width: radiusX * 2 + 36,
        height: radiusY * 2 + 36,
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
  const center = (box: Box) => ({
    x: box.x + box.width / 2,
    y: box.y + box.height / 2,
  });
  const fileById = new Map(model.files.map((file) => [file.id, file]));
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
          if (
            event.target !== event.currentTarget &&
            !(
              event.target instanceof Element &&
              event.target.closest(".graph-2d-directory")
            )
          )
            return;
          event.currentTarget.setPointerCapture(event.pointerId);
          pointers.current.set(event.pointerId, point(event));
          dragged.current = false;
        }}
        onPointerMove={(event) => {
          const previous = pointers.current.get(event.pointerId);
          if (!previous) return;
          const next = point(event);
          const others = [...pointers.current].filter(
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
          } else {
            setView((old) => ({
              ...old,
              x: old.x + next.x - previous.x,
              y: old.y + next.y - previous.y,
            }));
          }
          dragged.current = true;
          pointers.current.set(event.pointerId, next);
        }}
        onPointerUp={(event) => {
          pointers.current.delete(event.pointerId);
          if (event.currentTarget.hasPointerCapture?.(event.pointerId))
            event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        onPointerCancel={(event) => pointers.current.delete(event.pointerId)}
      >
        <g transform={`translate(${view.x} ${view.y}) scale(${view.scale})`}>
          {[...layout.directories]
            .sort(([a], [b]) => a.split("/").length - b.split("/").length)
            .map(([path, box]) => (
              <g
                key={path}
                className="graph-2d-directory"
                style={{ color: groupColor(path) }}
              >
                <title>{path === "." ? "Repository root" : path}</title>
                <rect
                  x={box.x}
                  y={box.y}
                  width={box.width}
                  height={box.height}
                  rx="8"
                />
                <text x={box.x + 14} y={box.y + 26}>
                  {path === "."
                    ? "Repository root"
                    : path.length > 30
                      ? `…${path.slice(-29)}`
                      : path}{" "}
                  ·{" "}
                  {
                    model.files.filter(
                      (file) =>
                        path === "." ||
                        file.parent === path ||
                        file.parent.startsWith(`${path}/`),
                    ).length
                  }
                </text>
              </g>
            ))}
          {model.files.length === 0 && (
            <text className="graph-2d-empty" x="42" y="73">
              No eligible files in this repository.
            </text>
          )}
          {model.connections.map((connection, index) => {
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
            const a = center(source),
              b = center(target);
            const outgoing = selectedId === connection.from;
            const incoming = selectedId === connection.to;
            const color = outgoing
              ? "#f0c98b"
              : incoming
                ? "#87b7ee"
                : "#72808b";
            const dx = b.x - a.x,
              dy = b.y - a.y,
              distance = Math.hypot(dx, dy) || 1;
            const ex = b.x - (dx / distance) * 24,
              ey = b.y - (dy / distance) * 24;
            const bend = ((index % 5) - 2) * 7;
            return (
              <path
                key={`${connection.from}:${connection.to}:${connection.kind}`}
                className={`graph-2d-edge ${selectedId && !outgoing && !incoming ? "dim" : ""}`}
                d={`M ${a.x} ${a.y} Q ${(a.x + ex) / 2 + bend} ${(a.y + ey) / 2} ${ex} ${ey}`}
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
            const box = layout.nodes.get(file.id)!;
            const selected = file.id === selectedId;
            const outgoing = model.outgoing
              .get(selectedId ?? "")
              ?.some((edge) => edge.to === file.id);
            const incoming = model.incoming
              .get(selectedId ?? "")
              ?.some((edge) => edge.from === file.id);
            return (
              <g
                key={file.id}
                role="button"
                tabIndex={0}
                aria-label={file.path}
                aria-pressed={selected}
                className={`graph-2d-file ${selected ? "selected" : outgoing ? "outgoing" : incoming ? "incoming" : ""}`}
                onClick={() => {
                  if (!dragged.current) onSelect(file.id);
                  dragged.current = false;
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onSelect(file.id);
                  }
                }}
              >
                <title>
                  {file.path} · {file.status} dependency analysis
                </title>
                <rect
                  x={box.x}
                  y={box.y}
                  width={box.width}
                  height={box.height}
                  rx="3"
                />
                <circle
                  cx={box.x + 12}
                  cy={box.y + 15}
                  r="4"
                  fill={groupColor(file.parent)}
                />
                <text x={box.x + 23} y={box.y + 19}>
                  {file.name.length > 27
                    ? `${file.name.slice(0, 25)}…`
                    : file.name}
                </text>
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
