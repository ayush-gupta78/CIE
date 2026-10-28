import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { createApp } from "./app.js";

it("serves exact snapshot-bound insights and impact without reanalysis", async () => {
  const root = await mkdtemp(join(tmpdir(), "cie-m5-"));
  const app = createApp();
  const headers = { host: "127.0.0.1:3001", origin: "http://127.0.0.1:5173" };
  const get = (url: string) => app.inject({ url, headers });
  const post = (url: string, payload: object) =>
    app.inject({
      method: "POST",
      url,
      payload,
      headers: { ...headers, "content-type": "application/json" },
    });
  try {
    await writeFile(join(root, "a.ts"), "import './b';\n");
    await writeFile(join(root, "b.ts"), "export {};\n");
    const { repositoryId, revision } = (
      await post("/api/v1/repository/select", { path: root })
    ).json();
    const base = `/api/v1/repository/insights?repositoryId=${repositoryId}&revision=${revision}`;
    expect(
      (await get(base + "&manifest=" + "a".repeat(64))).json().error.code,
    ).toBe("NO_GRAPH");
    const graph = (
      await post("/api/v1/repository/analyze", { repositoryId, revision })
    ).json();
    const query = `repositoryId=${repositoryId}&revision=${revision}&manifest=${graph.manifest}`;
    const insights = await get(`/api/v1/repository/insights?${query}`);
    expect(insights.statusCode).toBe(200);
    expect(insights.json()).toMatchObject({
      repositoryId,
      revision,
      manifest: graph.manifest,
      totals: {
        files: 2,
        relationships: 1,
        declarations: 1,
        unresolved: 0,
        external: 0,
        cycleGroups: 0,
        cycleFiles: 0,
        isolated: 0,
      },
    });
    expect(Object.keys(insights.json())).toEqual([
      "repositoryId",
      "revision",
      "manifest",
      "totals",
      "files",
      "cycles",
    ]);
    expect(Object.keys(insights.json().totals)).toEqual([
      "files",
      "relationships",
      "declarations",
      "unresolved",
      "external",
      "cycleGroups",
      "cycleFiles",
      "isolated",
      "statuses",
    ]);
    expect(Object.keys(insights.json().files[0])).toEqual([
      "id",
      "path",
      "parent",
      "status",
      "directDependencies",
      "directDependents",
      "transitiveDependencies",
      "transitiveDependents",
      "cycleIds",
    ]);
    const id = graph.files.find((f: { path: string }) => f.path === "b.ts").id;
    const impact = await get(`/api/v1/repository/impact?${query}&fileId=${id}`);
    expect(impact.statusCode).toBe(200);
    expect(impact.json()).toMatchObject({
      fileId: id,
      total: 1,
      direct: [graph.files.find((f: { path: string }) => f.path === "a.ts").id],
      indirect: [],
    });
    expect(Object.keys(impact.json())).toEqual([
      "repositoryId",
      "revision",
      "manifest",
      "fileId",
      "total",
      "direct",
      "indirect",
      "affected",
    ]);
    expect(Object.keys(impact.json().affected[0])).toEqual([
      "id",
      "path",
      "parent",
      "distance",
      "chain",
    ]);
    await writeFile(join(root, "b.ts"), "import './a';\n");
    expect((await get(`/api/v1/repository/insights?${query}`)).json()).toEqual(
      insights.json(),
    );
    expect(
      (
        await get(`/api/v1/repository/impact?${query}&fileId=${"0".repeat(64)}`)
      ).json().error.code,
    ).toBe("NOT_FOUND");
    for (const url of [
      base,
      base + `&manifest=${graph.manifest}&extra=x`,
      base + `&manifest=${graph.manifest}&manifest=${graph.manifest}`,
      base.replace(`revision=${revision}`, "revision=01") +
        `&manifest=${graph.manifest}`,
      `/api/v1/repository/impact?${query}&fileId=${"x".repeat(1025)}`,
    ]) {
      const response = await get(url);
      expect(response.statusCode, url).toBe(400);
      expect(response.json().error.code).toBe("INVALID_INPUT");
    }
    for (const suffix of [
      `repositoryId=00000000-0000-4000-8000-000000000000&revision=${revision}&manifest=${graph.manifest}`,
      `repositoryId=${repositoryId}&revision=${revision + 1}&manifest=${graph.manifest}`,
      `repositoryId=${repositoryId}&revision=${revision}&manifest=${"f".repeat(64)}`,
    ]) {
      const response = await get(`/api/v1/repository/insights?${suffix}`);
      expect(response.statusCode).toBe(409);
      expect(response.json().error.code).toBe("STALE_REPOSITORY");
    }
    await writeFile(join(root, "broken.ts"), "x".repeat(1024 * 1024 + 1));
    expect(
      (await post("/api/v1/repository/analyze", { repositoryId, revision }))
        .statusCode,
    ).toBe(422);
    expect((await get(`/api/v1/repository/insights?${query}`)).json()).toEqual(
      insights.json(),
    );
    await rm(join(root, "broken.ts"));
    const updated = (
      await post("/api/v1/repository/analyze", { repositoryId, revision })
    ).json();
    expect(updated.manifest).not.toBe(graph.manifest);
    expect(
      (await get(`/api/v1/repository/insights?${query}`)).json().error.code,
    ).toBe("STALE_REPOSITORY");
    expect(
      (
        await get(
          `/api/v1/repository/insights?repositoryId=${repositoryId}&revision=${revision}&manifest=${updated.manifest}`,
        )
      ).json().totals.cycleGroups,
    ).toBe(1);
    const fresh = (await post("/api/v1/repository/rescan", {})).json();
    expect(
      (await get(`/api/v1/repository/insights?${query}`)).json().error.code,
    ).toBe("STALE_REPOSITORY");
    expect(
      (
        await get(
          `/api/v1/repository/insights?repositoryId=${repositoryId}&revision=${fresh.revision}&manifest=${graph.manifest}`,
        )
      ).json().error.code,
    ).toBe("NO_GRAPH");
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});
