import { expect, it } from "vitest";
import { layoutGraph2D, frameBox } from "./graphLayout2D";
import { projectGraph } from "./graphModel";
import type { Graph } from "./graphApi";

const file = (
  id: string,
  path: string,
  status: Graph["files"][number]["status"] = "unsupported",
) => ({
  id,
  path,
  name: path.split("/").at(-1)!,
  parent: path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : ".",
  language: "Unknown",
  status,
});
const graph = (files: Graph["files"], edges: Graph["edges"] = []): Graph => ({
  schemaVersion: 1,
  analyzerVersion: "fixture",
  manifest: "fixture",
  repositoryId: "fixture",
  revision: 1,
  directories: [],
  files,
  edges,
  diagnostics: [],
  counts: {
    files: files.length,
    resolved: edges.length,
    unresolved: 0,
    skipped: 0,
    bytes: 0,
  },
  partial: true,
});
const edge = (
  id: string,
  from: string,
  to: string,
): Graph["edges"][number] => ({
  id,
  from,
  to,
  kind: "imports",
  resolution: "resolved_static",
  specifier: "./target",
  evidence: {
    path: "src/source.ts",
    line: 1,
    column: 1,
    rule: "fixture",
    sha256: "hash",
  },
});

it("positions every real file and nested directory deterministically across input order", () => {
  const files = [
    file("a", "apps/web/src/index.ts"),
    file("b", "apps/server/src/index.ts"),
    file("c", "README.md"),
    file("d", "assets/logo.png"),
    file("e", "assets/opaque.bin"),
    file("f", "LICENSE"),
    file("g", "other/unconnected.custom"),
  ];
  const first = layoutGraph2D(
    projectGraph(graph(files, [edge("e", "a", "b")])),
  );
  const second = layoutGraph2D(
    projectGraph(graph([...files].reverse(), [edge("e", "a", "b")])),
  );
  expect(second).toEqual(first);
  expect(first.nodes.size).toBe(files.length);
  for (const entry of files) {
    const box = first.nodes.get(entry.id)!;
    expect(Object.values(box).every(Number.isFinite)).toBe(true);
    expect(
      first.groups.find((group) => group.path === entry.parent),
    ).toBeTruthy();
  }
  expect(first.groups.map((group) => group.path)).toEqual(
    expect.arrayContaining(["apps/web/src", "apps/server/src", "other"]),
  );
  expect(
    new Set([...first.nodes.values()].map((box) => `${box.x}:${box.y}`)).size,
  ).toBe(files.length);
  const boxes = [...first.nodes.values()];
  for (let i = 0; i < boxes.length; i++)
    for (let j = i + 1; j < boxes.length; j++)
      expect(
        Math.hypot(boxes[i].x - boxes[j].x, boxes[i].y - boxes[j].y),
      ).toBeGreaterThanOrEqual(48);
  expect(first.bounds.width).toBeGreaterThan(0);
  expect(first.bounds.height).toBeGreaterThan(0);
});

it("projects only evidence-backed directed edges and retains unsupported isolated files", () => {
  const files = [
    file("a", "src/source.ts", "parsed"),
    file("b", "docs/target.md"),
    file("c", "asset"),
  ];
  const unresolved: Graph["edges"][number] = {
    ...edge("missing", "a", "b"),
    to: null,
    resolution: "unresolved",
  };
  const model = projectGraph(
    graph(files, [edge("actual", "a", "b"), unresolved]),
  );
  expect(model.connections).toHaveLength(1);
  expect(model.connections[0].edges.map((item) => item.id)).toEqual(["actual"]);
  expect(layoutGraph2D(model).nodes.has("c")).toBe(true);
});

it("frames empty, single-file, and explicit 200-file / 900-declaration synthetic stress fixtures", () => {
  for (const files of [[], [file("one", "one")]]) {
    const layout = layoutGraph2D(projectGraph(graph(files)));
    const view = frameBox(layout.bounds, 320, 300);
    expect(Object.values(view).every(Number.isFinite)).toBe(true);
    expect(view.scale).toBeGreaterThan(0);
  }
  const files = Array.from({ length: 200 }, (_, index) =>
    file(`id${index}`, `module${index % 10}/nested/file${index}.ts`),
  );
  const edges = Array.from({ length: 900 }, (_, index) =>
    edge(
      `edge${index}`,
      `id${index % 200}`,
      `id${(index + 1 + Math.floor(index / 200)) % 200}`,
    ),
  );
  const model = projectGraph(graph(files, edges));
  const layout = layoutGraph2D(model);
  expect(layout.nodes.size).toBe(200);
  expect(
    model.connections.reduce((sum, connection) => sum + connection.count, 0),
  ).toBe(900);
  expect(Object.values(layout.bounds).every(Number.isFinite)).toBe(true);
  const positions = [...layout.nodes.values()];
  for (let i = 0; i < positions.length; i++)
    for (let j = i + 1; j < positions.length; j++)
      expect(
        Math.hypot(
          positions[i].x - positions[j].x,
          positions[i].y - positions[j].y,
        ),
      ).toBeGreaterThanOrEqual(48);
  expect(frameBox(layout.bounds, 375, 480).scale).toBeGreaterThan(0);
  const node = layout.nodes.get("id0")!;
  expect(
    frameBox(
      { x: node.x - 20, y: node.y - 20, width: 40, height: 40 },
      375,
      480,
    ).scale,
  ).toBeLessThanOrEqual(2);
});

it("fits a deeply nested, disconnected inventory within a narrow stage", () => {
  const files = Array.from({ length: 180 }, (_, index) =>
    file(`deep${index}`, `module${index}/a/b/c/d/file`),
  );
  const bounds = layoutGraph2D(projectGraph(graph(files))).bounds;
  const view = frameBox(bounds, 320, 300);
  expect(view.x + bounds.x * view.scale).toBeGreaterThanOrEqual(0);
  expect(view.y + bounds.y * view.scale).toBeGreaterThanOrEqual(0);
  expect(view.x + (bounds.x + bounds.width) * view.scale).toBeLessThanOrEqual(
    320,
  );
  expect(view.y + (bounds.y + bounds.height) * view.scale).toBeLessThanOrEqual(
    300,
  );
});

it("separates circular files while drawing verified neighbors together", () => {
  const files = [
    ...Array.from({ length: 20 }, (_, index) =>
      file(`web${index}`, `apps/web/src/file${index}.ts`, "parsed"),
    ),
    file("server", "apps/server/src/service.ts", "parsed"),
    file("isolated", "docs/README.md"),
  ];
  const layout = layoutGraph2D(
    projectGraph(graph(files, [edge("cross", "web0", "server")])),
  );
  const points = [...layout.nodes.values()];
  for (let i = 0; i < points.length; i++)
    for (let j = i + 1; j < points.length; j++)
      expect(
        Math.hypot(points[i].x - points[j].x, points[i].y - points[j].y),
      ).toBeGreaterThanOrEqual(48);
  const source = layout.nodes.get("web0")!;
  const target = layout.nodes.get("server")!;
  const unrelated = layout.nodes.get("isolated")!;
  expect(Math.hypot(source.x - target.x, source.y - target.y)).toBeLessThan(
    Math.hypot(source.x - unrelated.x, source.y - unrelated.y),
  );
});

it("uses the wide map stage rather than collapsing a mixed repository into a tall strip", () => {
  const files = [
    ...Array.from({ length: 70 }, (_, i) =>
      file(`asset${i}`, `docs/screenshots/shot${i}.png`),
    ),
    ...Array.from({ length: 32 }, (_, i) =>
      file(`web${i}`, `apps/web/src/file${i}.ts`, "parsed"),
    ),
    ...Array.from({ length: 10 }, (_, i) =>
      file(`server${i}`, `apps/server/src/file${i}.ts`, "parsed"),
    ),
    ...Array.from({ length: 11 }, (_, i) => file(`root${i}`, `root${i}.json`)),
  ];
  const edges = Array.from({ length: 64 }, (_, i) =>
    edge(`e${i}`, `web${i % 32}`, `web${(i + 1) % 32}`),
  );
  const bounds = layoutGraph2D(projectGraph(graph(files, edges))).bounds;
  expect(bounds.width / bounds.height).toBeGreaterThan(1.4);
});
