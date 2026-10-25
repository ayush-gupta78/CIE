import {
  mkdtemp,
  mkdir,
  writeFile,
  rm,
  symlink,
  stat,
  chmod,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from "vitest";
import { createApp } from "./app.js";

let app: ReturnType<typeof createApp>;
let base: string;
let root: string;
let sibling: string;
const headers = { host: "127.0.0.1:3001", origin: "http://127.0.0.1:5173" };
const json = { ...headers, "content-type": "application/json" };
const get = (url: string) => app.inject({ url, headers });
const post = (url: string, body: object) =>
  app.inject({ method: "POST", url, headers: json, payload: body });
const del = () =>
  app.inject({
    method: "DELETE",
    url: "/api/v1/repository",
    headers: json,
    payload: {},
  });
const select = (path = root) => post("/api/v1/repository/select", { path });
const tree = (dir: string, id: string, revision: number, extra = "") =>
  get(
    `/api/v1/repository/tree?dir=${encodeURIComponent(dir)}&repositoryId=${id}&revision=${revision}${extra}`,
  );

beforeAll(async () => {
  base = await mkdtemp(join(tmpdir(), "cie-m1-"));
  root = join(base, "repo");
  sibling = join(base, "repo-secret");
  for (const path of [
    root,
    sibling,
    join(root, "src", "nested"),
    join(root, "src", "feature space"),
    join(root, "node_modules"),
    join(root, "dist"),
    join(root, "prompts", "m1"),
    join(root, "empty-directory"),
    join(root, "many-files"),
    join(root, "module.with.dot"),
    join(root, ".git"),
  ])
    await mkdir(path, { recursive: true });
  const files: Record<string, string> = {
    ".gitignore": "prompts/\nsecrets.txt\n*.tmp\n",
    ".env": "DO_NOT_LEAK=secret",
    ".env.example": "KEY=",
    "README.md": "hello",
    LICENSE: "text",
    "src/main.ts": "export {};",
    "src/util.test.ts": "test",
    "src/feature space/café.ts": "file",
    "src/nested/.gitignore": "!keep.tmp\n",
    "src/nested/keep.tmp": "kept",
    "src/nested/skip.tmp": "hidden",
    "backend.py": "pass",
    "node_modules/junk.js": "hidden",
    "dist/output.js": "hidden",
    "prompts/m1/private.md": "hidden",
    ".git/config": "hidden",
    "secrets.txt": "hidden",
  };
  for (const [name, value] of Object.entries(files))
    await writeFile(join(root, name), value);
  await writeFile(join(sibling, "secret.ts"), "private");
  await Promise.all(
    Array.from({ length: 230 }, (_, i) =>
      writeFile(
        join(root, "many-files", `f${String(i).padStart(3, "0")}.txt`),
        "x",
      ),
    ),
  );
  try {
    await symlink(sibling, join(root, "outside-link"), "dir");
    await symlink(join(root, "src"), join(root, "internal-link"), "dir");
  } catch {
    /* unsupported filesystem */
  }
});
afterAll(async () => {
  await rm(base, { recursive: true, force: true });
});
beforeEach(() => {
  app = createApp();
});
afterEach(async () => {
  await app.close();
});

it("requires deliberate absolute selection and returns safe public state", async () => {
  expect((await get("/api/v1/repository")).json()).toEqual({ selected: false });
  expect((await get("/api/v1/repository/tree?dir=.")).statusCode).toBe(409);
  for (const path of [
    "",
    "relative",
    join(base, "missing"),
    join(root, "README.md"),
  ])
    expect((await select(path)).statusCode).toBeGreaterThanOrEqual(400);
  const result = await select();
  expect(result.statusCode).toBe(200);
  expect(result.json()).toMatchObject({
    selected: true,
    rootName: basename(root),
    revision: 1,
  });
  expect(JSON.stringify(result.json())).not.toContain(base);
  expect((await get("/api/v1/repository")).json()).toEqual(result.json());
});

it("lists real children only, with nested negation, metadata and no secrets", async () => {
  const { repositoryId, revision } = (await select()).json();
  const response = await tree(".", repositoryId, revision);
  expect(response.statusCode).toBe(200);
  const entries = response.json().entries;
  const names = entries.map((entry: { name: string }) => entry.name);
  for (const absent of [
    ".git",
    "node_modules",
    "dist",
    "prompts",
    "secrets.txt",
    ".env",
    "outside-link",
    "internal-link",
  ])
    expect(names).not.toContain(absent);
  for (const present of [
    "README.md",
    ".env.example",
    "src",
    "empty-directory",
    "LICENSE",
    "module.with.dot",
  ])
    expect(names).toContain(present);
  const firstFile = entries.findIndex(
    (e: { kind: string }) => e.kind === "file",
  );
  expect(
    entries
      .slice(0, firstFile)
      .every((e: { kind: string }) => e.kind === "directory"),
  ).toBe(true);
  expect(
    entries.find((e: { name: string }) => e.name === "README.md"),
  ).toMatchObject({
    path: "README.md",
    kind: "file",
    sizeBytes: 5,
    languageHint: "Markdown",
  });
  const nested = (await tree("src/nested", repositoryId, revision))
    .json()
    .entries.map((e: { name: string }) => e.name);
  expect(nested).toContain("keep.tmp");
  expect(nested).not.toContain("skip.tmp");
  expect(
    (await tree("src/feature space", repositoryId, revision)).json().entries[0]
      .path,
  ).toBe("src/feature space/café.ts");
  expect(
    (await tree("empty-directory", repositoryId, revision)).json().entries,
  ).toEqual([]);
});

it("rejects traversal, ignored parents, symlinks and sibling prefix collisions", async () => {
  const { repositoryId: id, revision: rev } = (await select()).json();
  for (const dir of [
    "../repo-secret",
    "src/../repo-secret",
    "/etc",
    "C:\\Windows",
    "src\\nested",
    "src//nested",
    "src/%2e%2e",
    "src\0nested",
    "prompts/m1",
    "node_modules",
    "outside-link",
    "internal-link",
  ]) {
    const response = await tree(dir, id, rev);
    expect(response.statusCode, dir).toBeGreaterThanOrEqual(400);
    expect(JSON.stringify(response.json())).not.toContain(base);
  }
  expect(
    (
      await get(
        `/api/v1/repository/tree?dir=%2e%2e&repositoryId=${id}&revision=${rev}`,
      )
    ).statusCode,
  ).toBe(400);
});

it("paginates deterministically and rejects invalid or stale cursors", async () => {
  const { repositoryId: id, revision: rev } = (await select()).json();
  const names: string[] = [];
  let cursor: string | null = null;
  do {
    const page: { entries: { name: string }[]; nextCursor: string | null } = (
      await tree(
        "many-files",
        id,
        rev,
        `&limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
      )
    ).json();
    names.push(...page.entries.map((e) => e.name));
    cursor = page.nextCursor;
  } while (cursor);
  expect(names).toHaveLength(230);
  expect(new Set(names).size).toBe(230);
  expect(names).toEqual([...names].sort());
  expect((await tree("many-files", id, rev, "&limit=201")).statusCode).toBe(
    400,
  );
  expect(
    (await tree("many-files", id, rev, "&cursor=garbage")).statusCode,
  ).toBe(400);
  const first = (await tree("many-files", id, rev, "&limit=2")).json();
  const refreshed = (await post("/api/v1/repository/rescan", {})).json();
  expect(refreshed.revision).toBeGreaterThan(rev);
  expect(
    (
      await tree(
        "many-files",
        id,
        rev,
        `&cursor=${encodeURIComponent(first.nextCursor)}`,
      )
    ).statusCode,
  ).toBe(409);
});

it("refreshes disk state and deselects without deleting files", async () => {
  const { repositoryId: id, revision: rev } = (await select()).json();
  await writeFile(join(root, "fresh-note.md"), "new");
  const next = (await post("/api/v1/repository/rescan", {})).json();
  expect(
    (await tree(".", id, next.revision))
      .json()
      .entries.map((e: { name: string }) => e.name),
  ).toContain("fresh-note.md");
  expect((await del()).json()).toEqual({ selected: false });
  expect((await stat(join(root, "fresh-note.md"))).isFile()).toBe(true);
  expect((await tree(".", id, rev)).statusCode).toBe(409);
});

it("rejects cross-site mutation before any selection and keeps the root unset", async () => {
  const hostile = await app.inject({
    method: "POST",
    url: "/api/v1/repository/select",
    headers: { ...json, origin: "https://evil.example" },
    payload: { path: root },
  });
  expect(hostile.statusCode).toBe(403);
  const badHost = await app.inject({
    method: "POST",
    url: "/api/v1/repository/select",
    headers: { ...json, host: "evil.example:3001" },
    payload: { path: root },
  });
  expect(badHost.statusCode).toBe(403);
  const form = await app.inject({
    method: "POST",
    url: "/api/v1/repository/select",
    headers: {
      ...headers,
      "content-type": "application/x-www-form-urlencoded",
    },
    payload: "path=/",
  });
  expect(form.statusCode).toBe(415);
  expect((await get("/api/v1/repository")).json()).toEqual({ selected: false });
});

it("bounds per-directory scanning and ignore-file reads", async () => {
  const huge = join(root, "huge");
  await mkdir(huge, { recursive: true });
  for (let i = 0; i < 5001; i += 100)
    await Promise.all(
      Array.from({ length: Math.min(100, 5001 - i) }, (_, j) =>
        writeFile(join(huge, `x${i + j}`), ""),
      ),
    );
  const { repositoryId: id, revision: rev } = (await select()).json();
  const response = await tree("huge", id, rev);
  expect(response.statusCode).toBe(422);
  expect(response.json().error.code).toBe("DIRECTORY_TOO_LARGE");
  await rm(huge, { recursive: true });
  const ignored = join(root, "ignore-heavy");
  await mkdir(ignored, { recursive: true });
  await writeFile(join(ignored, ".gitignore"), "x".repeat(256 * 1024 + 1));
  const oversized = await tree("ignore-heavy", id, rev);
  expect(oversized.statusCode).toBe(422);
  expect(JSON.stringify(oversized.json())).not.toContain(base);
  await rm(ignored, { recursive: true });
});

it("rejects symlink root and malformed selection without changing selection", async () => {
  const link = join(base, "root-link");
  try {
    await symlink(root, link, "dir");
    expect((await select(link)).statusCode).toBe(403);
    await rm(link);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EPERM") throw error;
  }
  expect((await select(root + "\0bad")).statusCode).toBe(400);
  expect((await get("/api/v1/repository")).json()).toEqual({ selected: false });
});

it("does not leak filesystem errors after selection or permission revocation", async () => {
  const { repositoryId: id, revision: rev } = (await select()).json();
  expect((await tree("missing", id, rev)).statusCode).toBe(404);
  const selectedFile = join(root, "src", "main.ts");
  await chmod(selectedFile, 0o000);
  try {
    const response = await tree("src/main.ts", id, rev);
    expect(response.statusCode).toBeGreaterThanOrEqual(400);
    expect(JSON.stringify(response.json())).not.toContain(base);
  } finally {
    await chmod(selectedFile, 0o644);
  }
});
