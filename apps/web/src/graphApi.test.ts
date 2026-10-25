import { afterEach, expect, it, vi } from "vitest";
import { analyzeRepository, getGraph, type Graph } from "./graphApi";

const selection = {
  selected: true as const,
  repositoryId: "r1",
  revision: 2,
  rootName: "repo",
};
const graph: Graph = {
  schemaVersion: 1,
  analyzerVersion: "m2-ts-2",
  manifest: "manifest",
  repositoryId: "r1",
  revision: 2,
  directories: ["src"],
  files: [
    {
      id: "a",
      path: "src/a.ts",
      name: "a.ts",
      parent: "src",
      language: "TypeScript",
      status: "parsed",
      sha256: "hash",
    },
  ],
  edges: [],
  diagnostics: [],
  counts: { files: 1, resolved: 0, unresolved: 0, skipped: 0, bytes: 16 },
  partial: false,
};
const reply = (body: unknown, status = 200) => ({
  ok: status < 400,
  status,
  json: async () => body,
});
afterEach(() => vi.unstubAllGlobals());

it("accepts a selection-bound graph from GET and explicit JSON analysis", async () => {
  const fetcher = vi.fn().mockResolvedValue(reply(graph));
  vi.stubGlobal("fetch", fetcher);
  expect(await getGraph(selection)).toEqual(graph);
  expect(await analyzeRepository(selection)).toEqual(graph);
  expect(fetcher.mock.calls[1][0]).toBe("/api/v1/repository/analyze");
  expect(fetcher.mock.calls[1][1]).toMatchObject({
    method: "POST",
    body: JSON.stringify({ repositoryId: "r1", revision: 2 }),
  });
});

it("reports NO_GRAPH without manufacturing nodes", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(reply({ error: { code: "NO_GRAPH" } }, 409)),
  );
  await expect(getGraph(selection)).rejects.toMatchObject({ code: "NO_GRAPH" });
});

it("rejects wrong schema, mismatched selection and malformed graph edges", async () => {
  for (const value of [
    { ...graph, schemaVersion: 2 },
    { ...graph, revision: 1 },
    { ...graph, repositoryId: "other" },
    { ...graph, files: [{ ...graph.files[0], path: "../escape" }] },
    {
      ...graph,
      edges: [
        {
          id: "e",
          from: "a",
          to: "missing",
          kind: "imports",
          resolution: "resolved_static",
          specifier: "./missing",
          evidence: {
            path: "src/a.ts",
            line: 1,
            column: 1,
            rule: "x",
            sha256: "hash",
          },
        },
      ],
    },
  ]) {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reply(value)));
    await expect(getGraph(selection)).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
    });
  }
});

it("reports offline requests without accepting stale graph data", async () => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
  await expect(getGraph(selection)).rejects.toMatchObject({ code: "OFFLINE" });
});
