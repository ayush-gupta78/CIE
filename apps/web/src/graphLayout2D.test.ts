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
    expect(first.directories.get(entry.parent)).toBeTruthy();
  }
  expect(first.directories.has("apps/web")).toBe(true);
  expect(first.directories.has("apps/server")).toBe(true);
  expect(first.directories.has("other")).toBe(true);
  expect(
    new Set([...first.nodes.values()].map((box) => `${box.x}:${box.y}`)).size,
  ).toBe(files.length);
  const boxes = [...first.nodes.values()];
  for (let i = 0; i < boxes.length; i++)
    for (let j = i + 1; j < boxes.length; j++)
      expect(
        boxes[i].x + boxes[i].width <= boxes[j].x ||
          boxes[j].x + boxes[j].width <= boxes[i].x ||
          boxes[i].y + boxes[i].height <= boxes[j].y ||
          boxes[j].y + boxes[j].height <= boxes[i].y,
      ).toBe(true);
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
  expect(frameBox(layout.bounds, 375, 480).scale).toBeGreaterThan(0);
  expect(
    frameBox(layout.nodes.get("id0")!, 375, 480).scale,
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
