import { expect, it } from "vitest";
import { homeDistance, layoutGraph, projectGraph } from "./graphModel";
import type { Graph } from "./graphApi";

const file = (id: string, path: string) => ({
  id,
  path,
  name: path.split("/").at(-1)!,
  parent: path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : ".",
  language: "TypeScript",
  status: "parsed" as const,
  sha256: "hash",
});
const edge = (
  id: string,
  from: string,
  to: string | null,
  resolution: "resolved_static" | "external" | "unresolved" = "resolved_static",
) => ({
  id,
  from,
  to,
  resolution,
  kind: "imports" as const,
  specifier: "./target",
  evidence: {
    path: "apps/web/a.ts",
    line: 1,
    column: 1,
    rule: "unique-relative-file",
    sha256: "hash",
  },
});
const graph = (files: Graph["files"], edges: Graph["edges"] = []): Graph => ({
  schemaVersion: 1,
  analyzerVersion: "m2-ts-2",
  manifest: "m1",
  repositoryId: "r1",
  revision: 1,
  directories: [],
  files,
  edges,
  diagnostics: [],
  counts: {
    files: files.length,
    resolved: edges.filter((e) => e.resolution === "resolved_static").length,
    unresolved: 0,
    skipped: 0,
    bytes: 0,
  },
  partial: false,
});

it("projects only verified directed edges, retains declarations, and indexes both directions", () => {
  const model = projectGraph(
    graph(
      [
        file("a", "apps/web/a.ts"),
        file("b", "apps/server/b.ts"),
        file("c", "c.ts"),
      ],
      [
        edge("e1", "a", "b"),
        edge("e2", "a", "b"),
        edge("e3", "b", "a"),
        edge("e4", "a", null, "external"),
        edge("e5", "a", null, "unresolved"),
      ],
    ),
  );
  expect(model.connections).toEqual([
    expect.objectContaining({ from: "a", to: "b", count: 2 }),
    expect.objectContaining({ from: "b", to: "a", count: 1 }),
  ]);
  expect(model.outgoing.get("a")?.map((e) => e.id)).toEqual(["e1", "e2"]);
  expect(model.incoming.get("a")?.map((e) => e.id)).toEqual(["e3"]);
  expect(model.outgoing.get("c")).toEqual([]);
  expect(model.groups.map((g) => g.path)).toEqual([
    ".",
    "apps/server",
    "apps/web",
  ]);
});

it("lays out arbitrary and flat directories in repeatable finite three-dimensional space", () => {
  const data = graph([
    file("a", "backend/a.ts"),
    file("b", "frontend/b.ts"),
    file("c", "shared/c.ts"),
    file("d", "tests/d.ts"),
    file("e", "root.ts"),
    file("f", "backend/f.ts"),
  ]);
  const first = layoutGraph(projectGraph(data));
  expect(layoutGraph(projectGraph(data))).toEqual(first);
  expect(first.positions.size).toBe(6);
  for (const pos of first.positions.values())
    expect(pos.every(Number.isFinite)).toBe(true);
  expect(
    new Set([...first.positions.values()].map((pos) => pos.join(","))).size,
  ).toBe(6);
  expect(
    new Set([...first.positions.values()].map((pos) => pos[2])).size,
  ).toBeGreaterThan(1);
  expect(
    new Set(first.groups.map((group) => group.position[2])).size,
  ).toBeGreaterThan(1);
  expect(first.radius).toBeGreaterThan(0);
  expect(
    first.groups.every((group) => group.position.every(Number.isFinite)),
  ).toBe(true);
  expect(layoutGraph(projectGraph(graph([]))).positions.size).toBe(0);
  expect(
    layoutGraph(projectGraph(graph([file("solo", "solo.ts")])))
      .positions.get("solo")
      ?.every(Number.isFinite),
  ).toBe(true);
});

it("keeps duplicate basenames distinct and stays bounded for many groups", () => {
  const data = graph(
    Array.from({ length: 200 }, (_, i) =>
      file(`f${i}`, `arbitrary/${i}/index.ts`),
    ),
    Array.from({ length: 1000 }, (_, i) =>
      edge(
        `e${i}`,
        `f${i % 200}`,
        `f${((i % 200) + Math.floor(i / 200) + 1) % 200}`,
      ),
    ),
  );
  const model = projectGraph(data);
  const result = layoutGraph(model);
  expect(result.positions.size).toBe(200);
  expect(
    model.connections.reduce((sum, connection) => sum + connection.count, 0),
  ).toBe(1000);
  expect(result.radius).toBeLessThan(150);
  expect(
    new Set([...result.positions.values()].map((point) => point.join(",")))
      .size,
  ).toBe(200);
  expect(
    Number.isFinite(
      homeDistance([...result.positions.values()], result.center, 0.7),
    ),
  ).toBe(true);
});

it("fits the same 3D bounds farther away in a narrow viewport", () => {
  const positions: [number, number, number][] = [
    [-20, 0, 0],
    [20, 0, 0],
  ];
  expect(homeDistance(positions, [0, 0, 0], 0.7)).toBeGreaterThan(
    homeDistance(positions, [0, 0, 0], 1.5),
  );
  expect(Number.isFinite(homeDistance(positions, [0, 0, 0], 0.7))).toBe(true);
});

it("nests real leaf folders inside module and major-root zones", () => {
  const layout = layoutGraph(
    projectGraph(
      graph([
        file("a", "apps/web/src/a.ts"),
        file("b", "apps/web/tests/b.ts"),
        file("c", "apps/server/src/c.ts"),
        file("d", "shared/src/d.ts"),
      ]),
    ),
  );
  expect(layout.zones.map((zone) => zone.path)).toEqual(
    expect.arrayContaining(["apps", "apps/web", "apps/server", "shared"]),
  );
  const point = (path: string) =>
    layout.groups.find((group) => group.path === path)!.position;
  const distance = (a: number[], b: number[]) =>
    Math.hypot(...a.map((value, i) => value - b[i]));
  expect(distance(point("apps/web/src"), point("apps/web/tests"))).toBeLessThan(
    distance(point("apps/web/src"), point("apps/server/src")),
  );
  const root = layout.zones.find((zone) => zone.path === "apps")!;
  const unrelated = layout.zones.find((zone) => zone.path === "shared")!;
  expect(distance(point("apps/web/src"), root.position)).toBeLessThan(
    distance(point("apps/web/src"), unrelated.position),
  );
});
