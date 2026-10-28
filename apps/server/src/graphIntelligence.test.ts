import { expect, it } from "vitest";
import { buildGraph, type Graph } from "./graph.js";
import { impact, insights } from "./graphIntelligence.js";

const graph = (paths: string[], links: [string, string][]): Graph => {
  const result = buildGraph(
    paths.map((path) => ({ path, bytes: Buffer.from("export {}") })),
    "repo",
    1,
    0,
  );
  const ids = new Map(result.files.map((file) => [file.path, file.id]));
  result.edges = links.map(([from, to], i) => ({
    id: `e${i}`,
    from: ids.get(from)!,
    to: ids.get(to)!,
    kind: "imports",
    resolution: "resolved_static",
    specifier: to,
    evidence: {
      path: from,
      line: i + 1,
      column: 1,
      rule: "test",
      sha256: "test",
    },
  }));
  return result;
};
const named = (g: Graph, path: string) =>
  g.files.find((f) => f.path === path)!.id;

it("reports empty and isolated files without inferred relationships", () => {
  expect(insights(graph([], [])).totals).toEqual({
    files: 0,
    relationships: 0,
    declarations: 0,
    unresolved: 0,
    external: 0,
    cycleGroups: 0,
    cycleFiles: 0,
    isolated: 0,
    statuses: { parsed: 0, partial: 0, unsupported: 0, skipped: 0, failed: 0 },
  });
  const g = graph(["alone.ts"], []);
  expect(insights(g).files).toEqual([
    {
      id: named(g, "alone.ts"),
      path: "alone.ts",
      parent: ".",
      status: "parsed",
      directDependencies: 0,
      directDependents: 0,
      transitiveDependencies: 0,
      transitiveDependents: 0,
      cycleIds: [],
    },
  ]);
  expect(impact(g, named(g, "alone.ts"))).toEqual({
    repositoryId: "repo",
    revision: 1,
    manifest: g.manifest,
    fileId: named(g, "alone.ts"),
    total: 0,
    direct: [],
    indirect: [],
    affected: [],
  });
});

it("keeps importer direction and shortest stable reverse impact through a diamond", () => {
  const g = graph(
    ["a.ts", "b.ts", "c.ts", "d.ts"],
    [
      ["a.ts", "b.ts"],
      ["a.ts", "c.ts"],
      ["b.ts", "d.ts"],
      ["c.ts", "d.ts"],
    ],
  );
  const byPath = Object.fromEntries(insights(g).files.map((f) => [f.path, f]));
  expect(byPath["a.ts"]).toMatchObject({
    directDependencies: 2,
    directDependents: 0,
    transitiveDependencies: 3,
    transitiveDependents: 0,
  });
  expect(byPath["d.ts"]).toMatchObject({
    directDependencies: 0,
    directDependents: 2,
    transitiveDependencies: 0,
    transitiveDependents: 3,
  });
  const result = impact(g, named(g, "d.ts"));
  expect(result.direct).toEqual([named(g, "b.ts"), named(g, "c.ts")]);
  expect(result.indirect).toEqual([named(g, "a.ts")]);
  expect(result.affected.at(-1)).toEqual({
    id: named(g, "a.ts"),
    path: "a.ts",
    parent: ".",
    distance: 2,
    chain: [named(g, "d.ts"), named(g, "b.ts"), named(g, "a.ts")],
  });
});

it("deduplicates parallel declarations, retains unresolved and external separately", () => {
  const g = graph(
    ["a.ts", "b.ts", "unknown.dat"],
    [
      ["a.ts", "b.ts"],
      ["a.ts", "b.ts"],
    ],
  );
  g.edges[1].kind = "reexports";
  g.edges.push(
    { ...g.edges[0], id: "missing", to: null, resolution: "unresolved" },
    { ...g.edges[0], id: "package", to: null, resolution: "external" },
  );
  g.files.find((f) => f.path === "unknown.dat")!.status = "unsupported";
  const result = insights(g);
  expect(result.totals).toMatchObject({
    relationships: 1,
    declarations: 2,
    unresolved: 1,
    external: 1,
    isolated: 1,
    statuses: { parsed: 2, partial: 0, unsupported: 1, skipped: 0, failed: 0 },
  });
  expect(result.files[0].directDependencies).toBe(1);
  expect(impact(g, named(g, "b.ts")).total).toBe(1);
});

it("finds directed SCCs, self loops, stable IDs and closed witnesses", () => {
  const paths = ["a.ts", "b.ts", "c.ts", "d.ts", "e.ts", "f.ts"];
  const links: [string, string][] = [
    ["a.ts", "b.ts"],
    ["b.ts", "a.ts"],
    ["c.ts", "d.ts"],
    ["d.ts", "e.ts"],
    ["e.ts", "c.ts"],
    ["f.ts", "f.ts"],
  ];
  const g = graph(paths, links);
  const result = insights(g);
  expect(result.totals).toMatchObject({
    cycleGroups: 3,
    cycleFiles: 6,
    isolated: 0,
  });
  expect(result.cycles.map((c) => c.files)).toEqual([
    [named(g, "a.ts"), named(g, "b.ts")],
    [named(g, "c.ts"), named(g, "d.ts"), named(g, "e.ts")],
    [named(g, "f.ts")],
  ]);
  for (const cycle of result.cycles) {
    expect(cycle.witness[0]).toBe(cycle.witness.at(-1));
    expect(cycle.relationships.length).toBeGreaterThan(0);
    for (let i = 1; i < cycle.witness.length; i++)
      expect(cycle.relationships).toContainEqual({
        from: cycle.witness[i - 1],
        to: cycle.witness[i],
      });
  }
  expect(
    result.files.find((f) => f.path === "f.ts")?.transitiveDependencies,
  ).toBe(0);
  expect(
    insights({
      ...g,
      files: [...g.files].reverse(),
      edges: [...g.edges].reverse(),
    }),
  ).toEqual(result);
  expect(impact(g, named(g, "a.ts")).affected).toEqual(
    impact({ ...g, edges: [...g.edges].reverse() }, named(g, "a.ts")).affected,
  );
});

it("handles the published 200-file and 1000-declaration ceiling", () => {
  const paths = Array.from(
    { length: 200 },
    (_, i) => `f${String(i).padStart(3, "0")}.ts`,
  );
  const g = graph(
    paths,
    Array.from({ length: 1000 }, (_, i): [string, string] => [
      paths[i % 199],
      paths[(i % 199) + 1],
    ]),
  );
  const result = insights(g);
  expect(result.totals).toMatchObject({
    files: 200,
    declarations: 1000,
    relationships: 199,
  });
  expect(result.files[0].transitiveDependencies).toBe(199);
  expect(impact(g, named(g, paths[199])).total).toBe(199);
});

it("includes unsupported targets in impact and excludes each source from cyclic reach", () => {
  const g = graph(
    ["a.ts", "b.ts", "asset.png", "lonely.bin"],
    [
      ["a.ts", "b.ts"],
      ["b.ts", "a.ts"],
      ["b.ts", "asset.png"],
    ],
  );
  g.files.find((file) => file.path === "asset.png")!.status = "unsupported";
  g.files.find((file) => file.path === "lonely.bin")!.status = "skipped";
  const result = insights(g);
  expect(result.totals).toMatchObject({
    cycleGroups: 1,
    cycleFiles: 2,
    isolated: 1,
  });
  expect(result.files.find((file) => file.path === "a.ts")).toMatchObject({
    transitiveDependencies: 2,
    transitiveDependents: 1,
  });
  expect(result.files.find((file) => file.path === "asset.png")).toMatchObject({
    status: "unsupported",
    directDependents: 1,
    transitiveDependents: 2,
  });
  expect(
    impact(g, named(g, "asset.png")).affected.map((file) => [
      file.path,
      file.distance,
    ]),
  ).toEqual([
    ["b.ts", 1],
    ["a.ts", 2],
  ]);
});
