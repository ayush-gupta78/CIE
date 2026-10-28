import { afterEach, expect, it, vi } from "vitest";
import { getInsights, getImpact } from "./findingsApi";
import type { Graph } from "./graphApi";

const repo = {
  selected: true as const,
  repositoryId: "r",
  revision: 2,
  rootName: "root",
};
const graph = {
  repositoryId: "r",
  revision: 2,
  manifest: "hash",
  files: [
    { id: "a", path: "src/a.ts", parent: "src", status: "parsed" },
    { id: "b", path: "lib/a.ts", parent: "lib", status: "partial" },
  ],
  edges: [{ from: "b", to: "a", resolution: "resolved_static" }],
  counts: { unresolved: 0 },
} as Graph;
const insights = {
  repositoryId: "r",
  revision: 2,
  manifest: "hash",
  totals: {
    files: 2,
    relationships: 1,
    declarations: 1,
    unresolved: 0,
    external: 0,
    cycleGroups: 0,
    cycleFiles: 0,
    isolated: 0,
    statuses: { parsed: 1, partial: 1, unsupported: 0, skipped: 0, failed: 0 },
  },
  files: [
    {
      id: "a",
      path: "src/a.ts",
      parent: "src",
      status: "parsed",
      directDependencies: 0,
      directDependents: 1,
      transitiveDependencies: 0,
      transitiveDependents: 1,
      cycleIds: [],
    },
    {
      id: "b",
      path: "lib/a.ts",
      parent: "lib",
      status: "partial",
      directDependencies: 1,
      directDependents: 0,
      transitiveDependencies: 1,
      transitiveDependents: 0,
      cycleIds: [],
    },
  ],
  cycles: [],
};
const impact = {
  repositoryId: "r",
  revision: 2,
  manifest: "hash",
  fileId: "a",
  total: 1,
  direct: ["b"],
  indirect: [],
  affected: [
    {
      id: "b",
      path: "lib/a.ts",
      parent: "lib",
      distance: 1,
      chain: ["a", "b"],
    },
  ],
};
afterEach(() => vi.unstubAllGlobals());
it("requests identity-bound findings and impact with canonical IDs", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce({ ok: true, json: async () => insights })
    .mockResolvedValueOnce({ ok: true, json: async () => impact });
  vi.stubGlobal("fetch", fetch);
  expect((await getInsights(repo, graph)).totals.relationships).toBe(1);
  expect((await getImpact(repo, graph, "a")).affected[0].chain).toEqual([
    "a",
    "b",
  ]);
  expect(fetch.mock.calls[0][0]).toBe(
    "/api/v1/repository/insights?repositoryId=r&revision=2&manifest=hash",
  );
  expect(fetch.mock.calls[1][0]).toBe(
    "/api/v1/repository/impact?repositoryId=r&revision=2&manifest=hash&fileId=a",
  );
});
it("accepts self-loop reach excluding the source and resolved-only declaration totals", async () => {
  const g = {
    ...graph,
    edges: [
      { from: "a", to: "a", resolution: "resolved_static" },
      { from: "a", to: null, resolution: "unresolved" },
    ],
  } as Graph;
  const value = {
    ...insights,
    totals: {
      ...insights.totals,
      unresolved: 1,
      cycleGroups: 1,
      cycleFiles: 1,
      isolated: 1,
    },
    files: [
      {
        ...insights.files[0],
        directDependencies: 1,
        directDependents: 1,
        transitiveDependencies: 0,
        transitiveDependents: 0,
        cycleIds: [1],
      },
      {
        ...insights.files[1],
        directDependencies: 0,
        directDependents: 0,
        transitiveDependencies: 0,
        transitiveDependents: 0,
      },
    ],
    cycles: [
      {
        id: 1,
        files: ["a"],
        relationships: [{ from: "a", to: "a" }],
        witness: ["a", "a"],
      },
    ],
  };
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok: true, json: async () => value }),
  );
  expect((await getInsights(repo, g)).totals.cycleFiles).toBe(1);
});

it("rejects stale identities, invented paths, inconsistent counts and invalid chains", async () => {
  for (const value of [
    { ...insights, manifest: "other" },
    {
      ...insights,
      files: [{ ...insights.files[0], path: "fake.ts" }, insights.files[1]],
    },
    { ...insights, totals: { ...insights.totals, files: 3 } },
    {
      ...insights,
      files: [{ ...insights.files[0], directDependents: 4 }, insights.files[1]],
    },
  ]) {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => value }),
    );
    await expect(getInsights(repo, graph)).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
    });
  }
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ...impact,
        affected: [{ ...impact.affected[0], chain: ["b", "a"] }],
      }),
    }),
  );
  await expect(getImpact(repo, graph, "a")).rejects.toMatchObject({
    code: "INVALID_RESPONSE",
  });
});
