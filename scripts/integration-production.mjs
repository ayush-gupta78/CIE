import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const fixture = await mkdtemp(join(tmpdir(), "cie-m9-integration-"));
const child = spawn(
  process.execPath,
  ["apps/server/dist/main.js", "--production"],
  { cwd: root, stdio: "ignore" },
);
const base = "http://127.0.0.1:3001/api/v1";
const call = async (route, method = "GET", body) => {
  const response = await fetch(base + route, {
    method,
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  return { status: response.status, data: await response.json() };
};
try {
  await mkdir(join(fixture, "src"));
  await writeFile(
    join(fixture, "src", "main.ts"),
    "import { value } from './util';\nexport const result = value;\n",
  );
  await writeFile(
    join(fixture, "src", "util.ts"),
    "export const value = 42;\n",
  );
  await writeFile(join(fixture, ".env"), "SECRET=synthetic-only\n");
  let ready = false;
  for (let i = 0; i < 60; i++) {
    if (child.exitCode !== null)
      throw new Error("server exited before readiness");
    try {
      if ((await call("/health")).status === 200) {
        ready = true;
        break;
      }
    } catch {
      /* waiting for startup */
    }
    await delay(100);
  }
  assert.ok(ready, "API failed to start");
  assert.deepEqual((await call("/repository")).data, { selected: false });
  assert.equal((await call("/ai/config")).data.enabled, false);
  assert.equal((await call("/repository/graph")).status, 409);
  const selected = await call("/repository/select", "POST", { path: fixture });
  assert.equal(selected.status, 200);
  const { repositoryId, revision } = selected.data;
  assert.ok(repositoryId && revision);
  const tree = await call(
    `/repository/tree?repositoryId=${repositoryId}&revision=${revision}&dir=.`,
  );
  assert.equal(tree.status, 200);
  assert.ok(!JSON.stringify(tree.data).includes(".env"));
  const analysis = await call("/repository/analyze", "POST", {
    repositoryId,
    revision,
  });
  assert.equal(analysis.status, 200);
  const graph = analysis.data;
  assert.equal(graph.files.length, 2);
  assert.equal(
    graph.edges.filter((edge) => edge.resolution === "resolved_static").length,
    1,
  );
  assert.equal((await call("/repository/graph")).data.manifest, graph.manifest);
  const main = graph.files.find((file) => file.path === "src/main.ts");
  assert.ok(main);
  const query = `repositoryId=${repositoryId}&revision=${revision}&manifest=${graph.manifest}`;
  assert.equal((await call(`/repository/insights?${query}`)).status, 200);
  assert.equal(
    (await call(`/repository/impact?${query}&fileId=${main.id}`)).status,
    200,
  );
  const sourceRoute = `/repository/source?${query}&fileId=${main.id}`;
  assert.equal((await call(sourceRoute)).data.freshness, "verified");
  assert.notEqual(
    (await call(`/repository/source?${query}&fileId=bogus`)).status,
    200,
  );
  assert.notEqual(
    (
      await call(
        `/repository/insights?repositoryId=${repositoryId}&revision=${revision}&manifest=stale`,
      )
    ).status,
    200,
  );
  await writeFile(
    join(fixture, "src", "main.ts"),
    "export const changed = true;\n",
  );
  assert.equal((await call(sourceRoute)).status, 409);
  const rescanned = await call("/repository/rescan", "POST", {});
  assert.equal(rescanned.status, 200);
  assert.equal((await call("/repository/graph")).status, 409);
  const alternate = await mkdtemp(join(tmpdir(), "cie-m9-switch-"));
  try {
    assert.equal(
      (await call("/repository/select", "POST", { path: alternate })).status,
      200,
    );
    assert.notEqual(
      (
        await call(
          `/repository/tree?repositoryId=${repositoryId}&revision=${revision}&dir=.`,
        )
      ).status,
      200,
    );
  } finally {
    await rm(alternate, { recursive: true, force: true });
  }
  assert.equal((await call("/repository", "DELETE", {})).status, 200);
  assert.deepEqual((await call("/repository")).data, { selected: false });
  console.log(
    "Production integration passed: selection, ignore, tree, analysis, graph, findings, impact, source freshness, stale manifest, rescan, switch, close, AI disabled.",
  );
} finally {
  child.kill("SIGTERM");
  await rm(fixture, { recursive: true, force: true });
}
