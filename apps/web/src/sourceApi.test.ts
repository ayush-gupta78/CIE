import { afterEach, expect, it, vi } from "vitest";
import { getSource } from "./sourceApi";
import { ApiError } from "./repositoryApi";

const graph = { repositoryId: "r&1", revision: 3, manifest: "m/1" };
const file = {
  id: "f?1",
  path: "src/a.ts",
  name: "a.ts",
  language: "TypeScript",
  status: "parsed" as const,
};
const source = {
  ...graph,
  fileId: file.id,
  path: file.path,
  name: file.name,
  language: file.language,
  status: file.status,
  freshness: "verified",
  text: "import x;\n",
  lineCount: 1,
};
const reply = (body: unknown, status = 200) => ({
  ok: status < 400,
  status,
  json: async () => body,
});
afterEach(() => vi.unstubAllGlobals());

it("requests only the selected graph identity and file with an abort signal", async () => {
  const fetcher = vi.fn().mockResolvedValue(reply(source));
  vi.stubGlobal("fetch", fetcher);
  const controller = new AbortController();
  expect(await getSource(graph, file, controller.signal)).toEqual(source);
  const [url, init] = fetcher.mock.calls[0];
  expect(url).toBe(
    "/api/v1/repository/source?repositoryId=r%261&revision=3&manifest=m%2F1&fileId=f%3F1",
  );
  expect(init.signal).toBe(controller.signal);
});

it("rejects mismatched identity and malformed source payloads", async () => {
  for (const value of [
    { ...source, manifest: "other" },
    { ...source, fileId: "other" },
    { ...source, text: null },
    { ...source, lineCount: -1 },
    { ...source, lineCount: 200000 },
    { ...source, text: "different\nsecond line" },
    { ...source, freshness: "magic" },
  ]) {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reply(value)));
    await expect(getSource(graph, file)).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
    });
  }
});

it("passes structured source errors through", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(reply({ error: { code: "STALE_SOURCE" } }, 409)),
  );
  await expect(getSource(graph, file)).rejects.toBeInstanceOf(ApiError);
  await expect(getSource(graph, file)).rejects.toMatchObject({
    code: "STALE_SOURCE",
  });
});
