import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { createApp } from "./app.js";

let base: string;
let root: string;
let app: ReturnType<typeof createApp>;
const headers = { host: "127.0.0.1:3001", origin: "http://127.0.0.1:5173" };
const post = (url: string, payload: object) =>
  app.inject({
    method: "POST",
    url,
    headers: { ...headers, "content-type": "application/json" },
    payload,
  });
const get = (url = "/api/v1/repository/graph") => app.inject({ url, headers });

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), "cie-m2-"));
  root = join(base, "repo");
  await mkdir(join(root, "apps", "web"), { recursive: true });
  await mkdir(join(root, "apps", "server"), { recursive: true });
  await mkdir(join(root, "node_modules"));
  await writeFile(join(root, ".gitignore"), "ignored/\n");
  await mkdir(join(root, "ignored"));
  await writeFile(join(root, "ignored", "hidden.ts"), "export {};");
  await writeFile(join(root, "node_modules", "hidden.ts"), "export {};");
  await writeFile(join(root, ".env"), "PASSWORD=secret");
  await writeFile(
    join(root, "apps", "web", "util.ts"),
    "export const value = 1;\n",
  );
  await writeFile(
    join(root, "apps", "server", "util.ts"),
    "export const value = 2;\n",
  );
  await writeFile(
    join(root, "apps", "web", "entry.ts"),
    "import { value } from './util';\nimport '../server/util';\nimport 'external';\nimport './absent';\nconst x = import('./util');\nexport { value } from './util';\n",
  );
  await writeFile(
    join(root, "apps", "web", "broken.ts"),
    "import { from './util';\n",
  );
  await writeFile(join(root, "apps", "web", "café.ts"), "export {};\n");
  await writeFile(
    join(root, "apps", "web", "side-effect.ts"),
    "import { writeFileSync } from 'node:fs'; writeFileSync('SENTINEL', 'executed');\n",
  );
  try {
    await symlink(base, join(root, "escape"), "dir");
  } catch {
    /* unsupported */
  }
  app = createApp();
});
afterEach(async () => {
  await app.close();
  await rm(base, { recursive: true, force: true });
});

it("builds a deterministic source-backed graph without executing source", async () => {
  expect((await get()).statusCode).toBe(409);
  const selected = (
    await post("/api/v1/repository/select", { path: root })
  ).json();
  const indexed = await post("/api/v1/repository/analyze", {
    repositoryId: selected.repositoryId,
    revision: selected.revision,
  });
  expect(indexed.statusCode).toBe(200);
  const graph = (await get()).json();
  expect(graph).toEqual(indexed.json());
  expect(graph.files.map((f: { path: string }) => f.path)).toContain(
    "apps/web/café.ts",
  );
  expect(graph.files.map((f: { path: string }) => f.path)).not.toContain(
    "node_modules/hidden.ts",
  );
  expect(graph.directories).toContain("apps/web");
  const entry = graph.files.find(
    (f: { path: string }) => f.path === "apps/web/entry.ts",
  );
  const webUtil = graph.files.find(
    (f: { path: string }) => f.path === "apps/web/util.ts",
  );
  const serverUtil = graph.files.find(
    (f: { path: string }) => f.path === "apps/server/util.ts",
  );
  expect(webUtil.id).not.toBe(serverUtil.id);
  expect(
    graph.edges.filter(
      (e: { from: string; to: string }) =>
        e.from === entry.id && e.to === webUtil.id,
    ),
  ).toHaveLength(2);
  expect(graph.edges).toContainEqual(
    expect.objectContaining({
      from: entry.id,
      to: serverUtil.id,
      resolution: "resolved_static",
      evidence: expect.objectContaining({
        path: "apps/web/entry.ts",
        line: 2,
        column: 1,
      }),
    }),
  );
  expect(graph.edges).toContainEqual(
    expect.objectContaining({
      from: entry.id,
      to: null,
      resolution: "external",
    }),
  );
  expect(graph.edges).toContainEqual(
    expect.objectContaining({
      from: entry.id,
      to: null,
      resolution: "unresolved",
    }),
  );
  expect(graph.diagnostics).toContainEqual(
    expect.objectContaining({
      path: "apps/web/broken.ts",
      code: "PARSE_ERROR",
    }),
  );
  expect(graph.diagnostics).toContainEqual(
    expect.objectContaining({
      path: "apps/web/entry.ts",
      code: "DYNAMIC_IMPORT",
    }),
  );
  expect(graph.partial).toBe(true);
  expect(await readFile(join(root, "SENTINEL")).catch(() => null)).toBeNull();
  const again = (
    await post("/api/v1/repository/analyze", {
      repositoryId: selected.repositoryId,
      revision: selected.revision,
    })
  ).json();
  expect(again).toEqual(graph);
  await writeFile(join(root, "apps", "web", "entry.ts"), "import './util';\n");
  expect((await get()).json()).toEqual(graph);
  const changed = (
    await post("/api/v1/repository/analyze", {
      repositoryId: selected.repositoryId,
      revision: selected.revision,
    })
  ).json();
  expect(changed.manifest).not.toBe(graph.manifest);
  expect(changed.edges).not.toEqual(graph.edges);
});

it("rejects stale selection and hostile graph requests", async () => {
  const selected = (
    await post("/api/v1/repository/select", { path: root })
  ).json();
  expect(
    (
      await post("/api/v1/repository/analyze", {
        repositoryId: selected.repositoryId,
        revision: selected.revision + 1,
      })
    ).statusCode,
  ).toBe(409);
  expect(
    (
      await app.inject({
        method: "POST",
        url: "/api/v1/repository/analyze",
        headers: {
          ...headers,
          origin: "https://evil.example",
          "content-type": "application/json",
        },
        payload: selected,
      })
    ).statusCode,
  ).toBe(403);
  expect(
    (
      await app.inject({
        url: "/api/v1/repository/graph",
        headers: { ...headers, host: "evil.example" },
      })
    ).statusCode,
  ).toBe(403);
  expect(
    (
      await post("/api/v1/repository/analyze", {
        path: "../../etc",
        ...selected,
      })
    ).statusCode,
  ).toBe(400);
});

it("retains the last graph after a failed bounded reanalysis and clears it on refresh", async () => {
  const selected = (
    await post("/api/v1/repository/select", { path: root })
  ).json();
  const first = (
    await post("/api/v1/repository/analyze", {
      repositoryId: selected.repositoryId,
      revision: selected.revision,
    })
  ).json();
  await writeFile(
    join(root, "apps", "web", "oversized.ts"),
    "a".repeat(1024 * 1024 + 1),
  );
  const failed = await post("/api/v1/repository/analyze", {
    repositoryId: selected.repositoryId,
    revision: selected.revision,
  });
  expect(failed.statusCode).toBe(422);
  expect(failed.json().error.code).toBe("ANALYSIS_LIMIT");
  expect((await get()).json()).toEqual(first);
  await post("/api/v1/repository/rescan", {});
  expect((await get()).statusCode).toBe(409);
});

it("retains binary-like source files without interpreting replacement characters as evidence", async () => {
  await writeFile(
    join(root, "apps", "web", "binary.ts"),
    Buffer.from([0xff, 0xfe, 0x00]),
  );
  const selected = (
    await post("/api/v1/repository/select", { path: root })
  ).json();
  const graph = (
    await post("/api/v1/repository/analyze", {
      repositoryId: selected.repositoryId,
      revision: selected.revision,
    })
  ).json();
  expect(graph.files).toContainEqual(
    expect.objectContaining({
      path: "apps/web/binary.ts",
      status: "skipped",
      contentKind: "binary",
      sizeBytes: 3,
    }),
  );
  expect(
    graph.edges.some(
      (edge: { evidence: { path: string } }) =>
        edge.evidence.path === "apps/web/binary.ts",
    ),
  ).toBe(false);
  expect(graph.diagnostics).toContainEqual({
    path: "apps/web/binary.ts",
    code: "UNSUPPORTED_ENCODING",
  });
});

it("discovers mixed regular files without inventing unsupported dependencies", async () => {
  await mkdir(join(root, "docs"));
  await mkdir(join(root, "assets"));
  await mkdir(join(root, "native"));
  await writeFile(join(root, "docs", "README.md"), "# Hello\n");
  await writeFile(
    join(root, "assets", "logo.png"),
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0]),
  );
  await writeFile(
    join(root, "assets", "large.bin"),
    Buffer.alloc(1024 * 1024 + 2),
  );
  await writeFile(join(root, "native", "mystery.xyzcustom"), "payload");
  await writeFile(join(root, "native", "no-extension"), "");
  await writeFile(join(root, "native", ".hidden"), "public");
  await writeFile(join(root, "native", "helper.py"), "x = 1\n");
  await writeFile(join(root, "native", "main.py"), "from .helper import x\n");
  await writeFile(join(root, "native", "config.h"), "#define VALUE 1\n");
  await writeFile(join(root, "native", "main.c"), '#include "config.h"\n');
  await writeFile(join(root, "native", "mod.rs"), "mod helper;\n");
  await writeFile(join(root, "native", "helper.rs"), "pub fn run() {}\n");
  await writeFile(
    join(root, "assets", "style.css"),
    "@import './base.css';\nbody {background:url('./logo.png')}\n",
  );
  await writeFile(join(root, "assets", "base.css"), "");
  await writeFile(
    join(root, "index.html"),
    '<link href="assets/style.css" rel="stylesheet"><img src="assets/logo.png">',
  );
  const selected = (
    await post("/api/v1/repository/select", { path: root })
  ).json();
  const payload = {
    repositoryId: selected.repositoryId,
    revision: selected.revision,
  };
  const response = await post("/api/v1/repository/analyze", payload);
  expect(response.statusCode).toBe(200);
  const graph = response.json();
  const byPath = new Map(
    graph.files.map((file: { path: string; id: string }) => [file.path, file]),
  );
  for (const path of [
    "docs/README.md",
    "assets/logo.png",
    "assets/large.bin",
    "native/mystery.xyzcustom",
    "native/no-extension",
    "native/.hidden",
    "native/helper.py",
    "native/main.py",
    "native/main.c",
    "native/config.h",
    "native/mod.rs",
    "native/helper.rs",
    "index.html",
    ".gitignore",
  ])
    expect(byPath.has(path), path).toBe(true);
  expect(byPath.has("node_modules/hidden.ts")).toBe(false);
  expect(byPath.has("ignored/hidden.ts")).toBe(false);
  expect(byPath.has(".env")).toBe(false);
  expect(byPath.get("assets/logo.png")).toMatchObject({
    category: "image",
    contentKind: "binary",
    status: "unsupported",
    sizeBytes: 5,
  });
  expect(byPath.get("assets/large.bin")).toMatchObject({
    category: "binary",
    contentKind: "binary",
    status: "unsupported",
    sizeBytes: 1024 * 1024 + 2,
  });
  expect(byPath.get("native/mystery.xyzcustom")).toMatchObject({
    category: "unknown",
    status: "unsupported",
  });
  expect(byPath.get("native/main.py")).toMatchObject({
    status: "partial",
    category: "source",
  });
  const pairs = graph.edges
    .filter(
      (edge: { resolution: string }) => edge.resolution === "resolved_static",
    )
    .map((edge: { from: string; to: string; kind: string }) => [
      graph.files.find((file: { id: string }) => file.id === edge.from)?.path,
      graph.files.find((file: { id: string }) => file.id === edge.to)?.path,
      edge.kind,
    ]);
  for (const pair of [
    ["native/main.py", "native/helper.py", "imports"],
    ["native/main.c", "native/config.h", "includes"],
    ["native/mod.rs", "native/helper.rs", "imports"],
    ["assets/style.css", "assets/base.css", "imports"],
    ["assets/style.css", "assets/logo.png", "asset"],
    ["index.html", "assets/style.css", "asset"],
    ["index.html", "assets/logo.png", "asset"],
  ])
    expect(pairs).toContainEqual(pair);
  expect(byPath.get("assets/logo.png")).toMatchObject({
    incomingCount: 2,
    outgoingCount: 0,
  });
  const again = (await post("/api/v1/repository/analyze", payload)).json();
  expect(again).toEqual(graph);
});

it("rejects analysis exceeding the source-file quota rather than publishing a partial graph", async () => {
  const crowded = join(root, "crowded");
  await mkdir(crowded);
  await Promise.all(
    Array.from({ length: 201 }, (_, i) =>
      writeFile(join(crowded, `${i}.ts`), "export {};\n"),
    ),
  );
  const selected = (
    await post("/api/v1/repository/select", { path: root })
  ).json();
  const response = await post("/api/v1/repository/analyze", {
    repositoryId: selected.repositoryId,
    revision: selected.revision,
  });
  expect(response.statusCode).toBe(422);
  expect((await get()).statusCode).toBe(409);
});

it("keeps an oversized non-JS file as a skipped node and counts the skipped analysis", async () => {
  await writeFile(
    join(root, "apps", "web", "large.py"),
    "x".repeat(1024 * 1024 + 1),
  );
  const selected = (
    await post("/api/v1/repository/select", { path: root })
  ).json();
  const response = await post("/api/v1/repository/analyze", {
    repositoryId: selected.repositoryId,
    revision: selected.revision,
  });
  expect(response.statusCode).toBe(200);
  expect(response.json().files).toContainEqual(
    expect.objectContaining({
      path: "apps/web/large.py",
      status: "skipped",
      sizeBytes: 1024 * 1024 + 1,
    }),
  );
  expect(response.json().counts.skipped).toBe(1);
});

it("rejects unrepresentable file paths rather than silently omitting them", async () => {
  await writeFile(join(root, "bad%name.md"), "public");
  const selected = (
    await post("/api/v1/repository/select", { path: root })
  ).json();
  const result = await post("/api/v1/repository/analyze", {
    repositoryId: selected.repositoryId,
    revision: selected.revision,
  });
  expect(result.statusCode).toBe(422);
  expect(result.json().error.code).toBe("ANALYSIS_LIMIT");
  expect((await get()).statusCode).toBe(409);
});

it("rejects too many empty directories without publishing an incomplete graph", async () => {
  await Promise.all(
    Array.from({ length: 1001 }, (_, i) => mkdir(join(root, `dir${i}`))),
  );
  const selected = (
    await post("/api/v1/repository/select", { path: root })
  ).json();
  const response = await post("/api/v1/repository/analyze", {
    repositoryId: selected.repositoryId,
    revision: selected.revision,
  });
  expect(response.statusCode).toBe(422);
  expect((await get()).statusCode).toBe(409);
}, 15_000);

it("maps excessive imports to a bounded API error and retains the prior graph", async () => {
  const selected = (
    await post("/api/v1/repository/select", { path: root })
  ).json();
  const payload = {
    repositoryId: selected.repositoryId,
    revision: selected.revision,
  };
  const before = (await post("/api/v1/repository/analyze", payload)).json();
  await writeFile(
    join(root, "apps", "web", "many.ts"),
    Array.from({ length: 1001 }, (_, i) => `import './missing${i}';`).join(
      "\n",
    ),
  );
  const response = await post("/api/v1/repository/analyze", payload);
  expect(response.statusCode).toBe(422);
  expect(response.json().error.code).toBe("ANALYSIS_LIMIT");
  expect((await get()).json()).toEqual(before);
});
