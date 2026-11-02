import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { once } from "node:events";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createApp } from "./app.js";
import { callProvider } from "./aiProvider.js";
import { AiApproval } from "./aiApproval.js";

let app: ReturnType<typeof createApp>;
let root: string;
let cookie: string;
let csrf: string;
let graph: {
  repositoryId: string;
  revision: number;
  manifest: string;
  files: { id: string; path: string }[];
};
const headers = { host: "127.0.0.1:3001", "content-type": "application/json" };
const post = (url: string, payload: object) =>
  app.inject({
    method: "POST",
    url,
    headers: { ...headers, cookie, "x-cie-csrf": csrf },
    payload,
  });
const put = (payload: object) =>
  app.inject({
    method: "PUT",
    url: "/api/v1/ai/config",
    headers: { ...headers, cookie, "x-cie-csrf": csrf },
    payload,
  });
const question = () => ({
  repositoryId: graph.repositoryId,
  revision: graph.revision,
  manifest: graph.manifest,
  question: "What is exported?",
});
const preview = () => post("/api/v1/ai/preview", question());
const approve = (id: string, overrides: object = {}) =>
  post("/api/v1/ai/approve", {
    id,
    repositoryId: graph.repositoryId,
    revision: graph.revision,
    manifest: graph.manifest,
    ...overrides,
  });

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "cie-approval-route-"));
  await writeFile(join(root, "a.ts"), "export const useful = 1;\n");
  app = createApp(
    (config, messages, signal, purpose, payload) =>
      purpose === "test"
        ? Promise.resolve({ ok: true })
        : callProvider(config, messages, signal, purpose, payload),
    undefined,
    "synthetic-pairing-secret",
  );

  const paired = await app.inject({
    method: "POST",
    url: "/api/v1/auth/pair",
    headers,
    payload: { secret: "synthetic-pairing-secret" },
  });
  cookie = String(paired.headers["set-cookie"]).split(";", 1)[0];
  csrf = paired.json().csrf;
  const selected = (
    await post("/api/v1/repository/select", { path: root })
  ).json();
  graph = (
    await post("/api/v1/repository/analyze", {
      repositoryId: selected.repositoryId,
      revision: selected.revision,
    })
  ).json();

  await put({ enabled: true, consent: true, apiKey: "synthetic-test-key" });
  await post("/api/v1/ai/test", {});
});
afterEach(async () => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  await app.close();
  await rm(root, { recursive: true, force: true });
});

it("does not send on preview or legacy ask and sends precisely the reviewed body on approval", async () => {
  const bodies: string[] = [];
  const server = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    bodies.push(body);
    response.end(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                answer: "useful",
                citations: [
                  {
                    fileId: graph.files[0].id,
                    line: 1,
                    quote: "export const useful",
                  },
                ],
              }),
            },
          },
        ],
      }),
    );
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No address");
  await put({
    enabled: true,
    consent: false,
    provider: "local",
    preset: "local",
    protocol: "openai-compatible",
    endpointUrl: `http://127.0.0.1:${address.port}/v1/chat/completions`,
    model: "synthetic-model",
    authMode: "none",
    local: true,
  });
  await put({ enabled: true, consent: true });
  await post("/api/v1/ai/test", {});
  try {
    expect((await post("/api/v1/ai/ask", question())).statusCode).toBe(409);
    const prepared = await preview();

    expect(prepared.statusCode, JSON.stringify(prepared.json())).toBe(200);
    const inspected = prepared.json();
    expect(inspected.payload).toContain("export const useful");
    expect(bodies).toHaveLength(0);
    const result = await approve(inspected.id);
    expect(result.statusCode).toBe(200);
    expect(result.json().status).toBe("cited");
    expect(bodies).toEqual([inspected.payload]);
    expect((await approve(inspected.id)).statusCode).toBe(409);
    expect(bodies).toHaveLength(1);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

it("rejects changed source before approval without sending", async () => {
  const prepared = (await preview()).json();
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  await writeFile(join(root, "a.ts"), "export const useful = 2;\n");
  expect((await approve(prepared.id)).json()).toMatchObject({
    error: { code: "STALE_SOURCE" },
  });
  expect(fetch).not.toHaveBeenCalled();
});

it("rejects stale snapshot, consent and destination without sending", async () => {
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  const first = (await preview()).json();
  expect(
    (await approve(first.id, { manifest: "0".repeat(64) })).statusCode,
  ).toBe(409);
  const second = (await preview()).json();
  await put({ enabled: true, consent: false });
  expect((await approve(second.id)).statusCode).toBe(409);
  await put({ enabled: true, consent: true, apiKey: "synthetic-test-key" });
  await post("/api/v1/ai/test", {});
  const third = (await preview()).json();
  await put({
    enabled: true,
    consent: true,
    model: "gpt-4o",
    apiKey: "synthetic-test-key",
  });
  expect((await approve(third.id)).statusCode).toBe(409);
  expect(fetch).not.toHaveBeenCalled();
});

it("rejects consent withdrawal during asynchronous approval validation", async () => {
  const bodies: string[] = [];
  const server = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    bodies.push(body);
    response.end(JSON.stringify({ choices: [{ message: { content: "{}" } }] }));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No address");
  try {
    await put({
      enabled: true,
      consent: false,
      preset: "local",
      protocol: "openai-compatible",
      endpointUrl: `http://127.0.0.1:${address.port}/v1/chat/completions`,
      model: "synthetic-model",
      authMode: "none",
      local: true,
    });
    await put({ enabled: true, consent: true });
    await post("/api/v1/ai/test", {});
    const prepared = (await preview()).json();
    const actual = AiApproval.prototype.approve;
    vi.spyOn(AiApproval.prototype, "approve").mockImplementation(function (
      this: AiApproval,
      id,
      snapshot,
      config,
      validate,
      send,
      now,
    ) {
      return actual.call(
        this,
        id,
        snapshot,
        config,
        async () => {
          await validate();
          expect(
            (await put({ enabled: false, consent: false })).statusCode,
          ).toBe(200);
        },
        send,
        now,
      );
    });
    expect((await approve(prepared.id)).statusCode).toBe(409);
    expect(bodies).toEqual([]);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
