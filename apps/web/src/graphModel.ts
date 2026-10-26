import type { FileEdge, FileNode, Graph } from "./graphApi";

export type Point = [number, number, number];
const directionLength = Math.hypot(0.55, 0.35, 0.76);
export const HOME_DIRECTION: Point = [
  0.55 / directionLength,
  0.35 / directionLength,
  0.76 / directionLength,
];
export type Connection = {
  from: string;
  to: string;
  kind: FileEdge["kind"];
  count: number;
  edges: FileEdge[];
};
export type Group = { path: string; files: FileNode[]; color: string };
export type SceneModel = {
  files: FileNode[];
  groups: Group[];
  connections: Connection[];
  incoming: Map<string, FileEdge[]>;
  outgoing: Map<string, FileEdge[]>;
};
const palette = [
  "#ba9a72",
  "#7d9baf",
  "#8da89f",
  "#9c8da9",
  "#b39a87",
  "#83a5ad",
];
export function groupColor(path: string): string {
  const parts = path.toLowerCase().split("/");
  const module = parts[1] ?? parts[0];
  if (/^(web|frontend|client|ui)$/.test(module)) return "#87b7ee";
  if (/^(server|backend|api)$/.test(module)) return "#e0ae69";
  if (/^(shared|common)$/.test(module)) return "#71cabc";
  if (/^(tests?|specs?)$/.test(module)) return "#a48acf";
  if (/^(docs?|documentation)$/.test(module)) return "#bbc4c6";
  if (/^(scripts?|tools?)$/.test(module)) return "#a8cc9a";
  let hash = 0;
  for (const char of path.split("/").slice(0, 2).join("/"))
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return palette[hash % palette.length];
}
export function projectGraph(graph: Graph): SceneModel {
  const files = [...graph.files].sort((a, b) =>
    a.path.localeCompare(b.path, "en"),
  );
  const ids = new Set(files.map((file) => file.id));
  const groups = new Map<string, FileNode[]>();
  const incoming = new Map(files.map((file) => [file.id, [] as FileEdge[]]));
  const outgoing = new Map(files.map((file) => [file.id, [] as FileEdge[]]));
  const merged = new Map<string, Connection>();
  for (const file of files)
    groups.set(file.parent, [...(groups.get(file.parent) ?? []), file]);
  for (const edge of graph.edges) {
    if (
      edge.resolution !== "resolved_static" ||
      !edge.to ||
      !ids.has(edge.from) ||
      !ids.has(edge.to)
    )
      continue;
    outgoing.get(edge.from)!.push(edge);
    incoming.get(edge.to)!.push(edge);
    const key = JSON.stringify([edge.from, edge.to, edge.kind]);
    const connection = merged.get(key);
    if (connection) {
      connection.count++;
      connection.edges.push(edge);
    } else
      merged.set(key, {
        from: edge.from,
        to: edge.to,
        kind: edge.kind,
        count: 1,
        edges: [edge],
      });
  }
  return {
    files,
    groups: [...groups]
      .sort(([a], [b]) => a.localeCompare(b, "en"))
      .map(([path, members]) => ({
        path,
        files: members,
        color: groupColor(path),
      })),
    connections: [...merged.values()],
    incoming,
    outgoing,
  };
}
export function layoutGraph(model: SceneModel): {
  positions: Map<string, Point>;
  groups: { path: string; position: Point; color: string }[];
  zones: { path: string; position: Point; radius: number; color: string }[];
  center: Point;
  radius: number;
} {
  const positions = new Map<string, Point>();
  const groups: { path: string; position: Point; color: string }[] = [];
  const zones: {
    path: string;
    position: Point;
    radius: number;
    color: string;
  }[] = [];
  const offset = (index: number, count: number, step: number): Point =>
    count === 1
      ? [0, 0, 0]
      : [
          ((index % 5) - (Math.min(count, 5) - 1) / 2) * step * 0.82,
          ((Math.floor(index / 5) % 5) -
            (Math.min(Math.ceil(count / 5), 5) - 1) / 2) *
            step +
            ((index % 2) - 0.5) * step * 0.4,
          (Math.floor(index / 25) - (Math.ceil(count / 25) - 1) / 2) * step +
            ((index % 3) - 1) * step * 0.26,
        ];
  const plus = (a: Point, b: Point): Point => [
    a[0] + b[0],
    a[1] + b[1],
    a[2] + b[2],
  ];
  const fileOffset = (index: number, count: number): Point => [
    ((index % 4) - (Math.min(count, 4) - 1) / 2) * 2.1,
    ((Math.floor(index / 4) % 4) -
      (Math.min(Math.ceil(count / 4), 4) - 1) / 2) *
      2.4,
    (Math.floor(index / 16) - (Math.ceil(count / 16) - 1) / 2) * 2.2 +
      ((index % 3) - 1) * 0.8,
  ];
  const roots = new Map<string, Map<string, Group[]>>();
  for (const group of model.groups) {
    const parts = group.path.split("/");
    const root = parts[0];
    const module = parts.slice(0, 2).join("/");
    const modules = roots.get(root) ?? new Map<string, Group[]>();
    modules.set(module, [...(modules.get(module) ?? []), group]);
    roots.set(root, modules);
  }
  // ponytail: deeper folders share their module zone; add recursive zones only if deep trees need them.
  const rootLayouts = [...roots]
    .sort(([a], [b]) => a.localeCompare(b, "en"))
    .map(([path, modules]) => {
      const children = [...modules]
        .sort(([a], [b]) => a.localeCompare(b, "en"))
        .map(([name, leaves]) => {
          const local = leaves.map((group, index) => ({
            group,
            position: offset(index, leaves.length, 9),
          }));
          const radius =
            Math.max(
              5,
              ...local.flatMap(({ group, position }) =>
                group.files.map((_, i) =>
                  Math.hypot(
                    ...plus(position, fileOffset(i, group.files.length)),
                  ),
                ),
              ),
            ) + 4;
          return { path: name, leaves: local, radius };
        });
      const step = Math.max(19, ...children.map((child) => child.radius * 1.3));
      const placed = children.map((child, index) => ({
        ...child,
        position: offset(index, children.length, step),
      }));
      const radius =
        Math.max(
          8,
          ...placed.map(
            (child) => Math.hypot(...child.position) + child.radius,
          ),
        ) + 4;
      return { path, children: placed, radius };
    });
  const rootStep = Math.max(
    25,
    ...rootLayouts.map((root) => root.radius * 1.2),
  );
  rootLayouts.forEach((root, rootIndex) => {
    const rootPosition = offset(rootIndex, rootLayouts.length, rootStep);
    if (
      root.path !== "." &&
      !(
        root.children.length === 1 &&
        root.children[0].path === root.path &&
        root.children[0].leaves.length === 1 &&
        root.children[0].leaves[0].group.path === root.path
      )
    )
      zones.push({
        path: root.path,
        position: rootPosition,
        radius: root.radius,
        color: groupColor(root.path),
      });
    root.children.forEach((module) => {
      const modulePosition = plus(rootPosition, module.position);
      if (
        module.path !== root.path &&
        !(
          module.leaves.length === 1 &&
          module.leaves[0].group.path === module.path
        )
      )
        zones.push({
          path: module.path,
          position: modulePosition,
          radius: module.radius,
          color: groupColor(module.path),
        });
      module.leaves.forEach(({ group, position: local }) => {
        const position = plus(modulePosition, local);
        groups.push({ path: group.path, position, color: group.color });
        group.files.forEach((file, index) =>
          positions.set(
            file.id,
            plus(position, fileOffset(index, group.files.length)),
          ),
        );
      });
    });
  });
  const points = [...positions.values()];
  if (!points.length)
    return { positions, groups, zones, center: [0, 0, 0], radius: 8 };
  const min = [0, 1, 2].map((axis) =>
    Math.min(...points.map((point) => point[axis])),
  );
  const max = [0, 1, 2].map((axis) =>
    Math.max(...points.map((point) => point[axis])),
  );
  const center: Point = [
    (min[0] + max[0]) / 2,
    (min[1] + max[1]) / 2,
    (min[2] + max[2]) / 2,
  ];
  const radius =
    Math.max(
      8,
      ...points.map((point) =>
        Math.hypot(
          point[0] - center[0],
          point[1] - center[1],
          point[2] - center[2],
        ),
      ),
    ) + 4;
  return { positions, groups, zones, center, radius };
}

export function homeDistance(
  points: Point[],
  center: Point,
  aspect: number,
): number {
  const [dx, dy, dz] = HOME_DIRECTION;
  const horizontal = Math.hypot(dx, dz);
  const tanVertical = Math.tan((55 * Math.PI) / 360);
  const tanHorizontal = tanVertical * Math.max(0.1, aspect);
  let distance = 12;
  for (const point of points) {
    const x = point[0] - center[0];
    const y = point[1] - center[1];
    const z = point[2] - center[2];
    const depth = x * dx + y * dy + z * dz;
    const right = (x * dz - z * dx) / horizontal;
    const up =
      (y * horizontal * horizontal - dy * (x * dx + z * dz)) / horizontal;
    distance = Math.max(
      distance,
      depth +
        Math.max(Math.abs(right) / tanHorizontal, Math.abs(up) / tanVertical),
    );
  }
  return distance * 1.08 + 2;
}
