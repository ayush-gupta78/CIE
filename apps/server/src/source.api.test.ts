import {
  mkdtemp,
  mkdir,
  readFile,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { afterEach, beforeEach, expect, it } from "vitest";
import { createApp } from "./app.js";
import type { Graph } from "./graph.js";

let root: string;
let app: ReturnType<typeof createApp>;
let graph: Graph;
const headers = { host: "127.0.0.1:3001", origin: "http://127.0.0.1:5173" };
const get = (url: string) => app.inject({ url, headers });
const post = (url: string, payload: object) =>
  app.inject({
    method: "POST",
    url,
    headers: { ...headers, "content-type": "application/json" },
    payload,
  });
const file = (path: string) => graph.files.find((item) => item.path === path)!;
const source = (fileId: string, overrides: Record<string, string> = {}) => {
  const params = new URLSearchParams({
    repositoryId: graph.repositoryId,
    revision: String(graph.revision),
    manifest: graph.manifest,
    fileId,
    ...overrides,
  });
  return get(`/api/v1/repository/source?${params}`);
};
const error = async (
  response: ReturnType<typeof get>,
  status: number,
  code: string,
) => {
  const result = await response;
  expect(result.statusCode).toBe(status);
  expect(result.json()).toEqual({
    error: { code, message: expect.any(String) },
  });
  expect(JSON.stringify(result.json())).not.toContain(root);
};

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "cie-source-"));
  await mkdir(join(root, "nested"));
  await writeFile(join(root, ".gitignore"), "hidden.txt\n");
  await writeFile(join(root, "hidden.txt"), "hidden");
  await writeFile(join(root, "nested", "a.ts"), "import '../target';\n");
  await writeFile(join(root, "target.ts"), "export const x = 1;\n");
  await writeFile(join(root, "note.txt"), "\ufeffhello\r\nworld\n");
  await writeFile(join(root, "raw.dat"), Buffer.from([0xff, 0]));
  app = createApp();
  const selected = (
    await post("/api/v1/repository/select", { path: root })
  ).json();
  const analyzed = await post("/api/v1/repository/analyze", {
    repositoryId: selected.repositoryId,
    revision: selected.revision,
  });
  expect(analyzed.statusCode).toBe(200);
  graph = analyzed.json();
});
afterEach(async () => {
  await app.close();
  await rm(root, { recursive: true, force: true });
});

it("serves only graph-file text bound to the exact captured SHA and counts lines", async () => {
  const item = file("nested/a.ts");
  const result = await source(item.id);
  expect(result.statusCode).toBe(200);
  expect(result.json()).toEqual({
    repositoryId: graph.repositoryId,
    revision: graph.revision,
    manifest: graph.manifest,
    fileId: item.id,
    path: item.path,
    name: item.name,
    language: item.language,
    status: item.status,
    freshness: "verified",
    text: "import '../target';\n",
    lineCount: 1,
  });
  expect(
    graph.edges.find((edge) => edge.evidence.path === item.path)!.evidence
      .sha256,
  ).toBe(item.sha256);
  expect(JSON.stringify(result.json())).not.toContain(root);
  expect(await readFile(join(root, item.path), "utf8")).toBe(
    "import '../target';\n",
  );
});

it("strips UTF-8 BOM and marks metadata-only text unverified", async () => {
  const item = file("note.txt");
  expect(item.sha256).toBeUndefined();
  const result = await source(item.id);
  expect(result.statusCode).toBe(200);
  expect(result.json()).toMatchObject({
    text: "hello\r\nworld\n",
    lineCount: 2,
    freshness: "unverified",
    fileId: item.id,
  });
});

it("rejects stale bytes even with unchanged length", async () => {
  const item = file("target.ts");
  await writeFile(join(root, item.path), "export const y = 1;\n");
  await error(source(item.id), 409, "STALE_SOURCE");
  expect((await get("/api/v1/repository/graph")).json()).toEqual(graph);
});

it("keeps graph metadata when an analyzed file is deleted", async () => {
  const item = file("target.ts");
  await rm(join(root, item.path));
  await error(source(item.id), 404, "NOT_FOUND");
  expect((await get("/api/v1/repository/graph")).json().files).toContainEqual(
    item,
  );
});

it("rejects malformed or stale identities and non-graph IDs", async () => {
  await error(
    source(file("target.ts").id, { manifest: "0".repeat(64) }),
    409,
    "STALE_REPOSITORY",
  );
  await error(source("0".repeat(64)), 404, "NOT_FOUND");
  await error(
    source(createHash("sha256").update("nested").digest("hex")),
    404,
    "NOT_FOUND",
  );
  await error(
    source(file("target.ts").id, { fileId: "../target.ts" }),
    400,
    "INVALID_INPUT",
  );
  await error(
    source(file("target.ts").id, { fileId: "/etc/passwd" }),
    400,
    "INVALID_INPUT",
  );
  await error(
    source(file("target.ts").id, { fileId: "nested%2Fa.ts" }),
    400,
    "INVALID_INPUT",
  );
  await error(
    source(file("target.ts").id, { revision: "1e0" }),
    400,
    "INVALID_INPUT",
  );
  await error(
    source(file("target.ts").id, { extra: "x" }),
    400,
    "INVALID_INPUT",
  );
  await error(
    get("/api/v1/repository/source?fileId=abc"),
    400,
    "INVALID_INPUT",
  );
});

it("rejects binary, invalid UTF-8, NUL and files over 256 KiB", async () => {
  await error(source(file("raw.dat").id), 415, "UNSUPPORTED_SOURCE");
  for (const bytes of [
    Buffer.from([0xff]),
    Buffer.from("abc\0def"),
    Buffer.alloc(256 * 1024 + 1, 65),
  ]) {
    await writeFile(join(root, "note.txt"), bytes);
    await error(
      source(file("note.txt").id),
      bytes.length > 256 * 1024 ? 422 : 415,
      bytes.length > 256 * 1024 ? "SOURCE_TOO_LARGE" : "UNSUPPORTED_SOURCE",
    );
  }
});

it("accepts the exact 256 KiB bound for metadata-only text", async () => {
  await writeFile(join(root, "note.txt"), "a".repeat(256 * 1024));
  const result = await source(file("note.txt").id);
  expect(result.statusCode).toBe(200);
  expect(result.json().text).toHaveLength(256 * 1024);
});

it("refuses a small file with an excessive line count", async () => {
  await writeFile(join(root, "note.txt"), "x\n".repeat(5001));
  await error(source(file("note.txt").id), 422, "SOURCE_TOO_LARGE");
});

it("rejects control-byte binary payloads even when UTF-8 decoding succeeds", async () => {
  await writeFile(join(root, "note.txt"), Buffer.from([65, 1, 66]));
  await error(source(file("note.txt").id), 415, "UNSUPPORTED_SOURCE");
});

it("refuses ignored ancestors and symlink substitutions", async () => {
  await writeFile(join(root, ".gitignore"), "nested/\n");
  await error(source(file("nested/a.ts").id), 403, "FORBIDDEN_PATH");
  await writeFile(join(root, ".gitignore"), "hidden.txt\n");
  await rename(join(root, "target.ts"), join(root, "old.ts"));
  await symlink(join(root, "old.ts"), join(root, "target.ts"));
  await error(source(file("target.ts").id), 403, "FORBIDDEN_PATH");
});

it("refuses a symlinked ancestor, hostile Host/Origin, and deselection", async () => {
  await rename(join(root, "nested"), join(root, "actual"));
  await symlink(join(root, "actual"), join(root, "nested"));
  await error(source(file("nested/a.ts").id), 403, "FORBIDDEN_PATH");
  const url = `/api/v1/repository/source?${new URLSearchParams({ repositoryId: graph.repositoryId, revision: String(graph.revision), manifest: graph.manifest, fileId: file("target.ts").id })}`;
  await error(
    app.inject({ url, headers: { host: "attacker.example" } }),
    403,
    "UNAPPROVED_HOST",
  );
  await error(
    app.inject({
      url,
      headers: { host: headers.host, origin: "http://attacker.example" },
    }),
    403,
    "UNAPPROVED_ORIGIN",
  );
  await app.inject({
    method: "DELETE",
    url: "/api/v1/repository",
    headers: { ...headers, "content-type": "application/json" },
    payload: {},
  });
  await error(source(file("target.ts").id), 409, "NO_REPOSITORY_SELECTED");
});

it("refuses replaced root and stale selection; failed reanalysis keeps prior graph", async () => {
  const previous = file("target.ts");
  await writeFile(join(root, "nested", "a.ts"), "x".repeat(1024 * 1024 + 1));
  await error(
    post("/api/v1/repository/analyze", {
      repositoryId: graph.repositoryId,
      revision: graph.revision,
    }),
    422,
    "ANALYSIS_LIMIT",
  );
  expect((await source(previous.id)).statusCode).toBe(200);
  await rename(root, `${root}-moved`);
  await mkdir(root);
  try {
    await error(source(previous.id), 403, "FORBIDDEN_PATH");
  } finally {
    await rm(root, { recursive: true });
    await rename(`${root}-moved`, root);
  }
  const selected = (await post("/api/v1/repository/rescan", {})).json();
  expect(selected.revision).not.toBe(graph.revision);
  await error(source(previous.id), 409, "STALE_REPOSITORY");
});
