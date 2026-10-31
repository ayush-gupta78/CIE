import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { request as httpRequest } from "node:http";
import { afterEach, expect, it, vi } from "vitest";
import { createApp } from "./app.js";
import { mockedProvider } from "./aiTestProvider.fixture.js";

const headers = { host: "127.0.0.1:3001", origin: "http://127.0.0.1:5173" };
const deferred = () => {
  let started!: () => void;
  const whenStarted = new Promise<void>((resolve) => (started = resolve));
  let aborted = false;
  const fetcher = vi.fn((_url: unknown, init: RequestInit) => {
    started();
    return new Promise<Response>((_resolve, reject) => {
      init.signal?.addEventListener("abort", () => {
        aborted = true;
        reject(new DOMException("Aborted", "AbortError"));
      });
    });
  });
  return {
    fetcher,
    whenStarted,
    get aborted() {
      return aborted;
    },
  };
};

async function setup() {
  const root = await mkdtemp(join(tmpdir(), "cie-cancel-"));
  await writeFile(join(root, "a.ts"), "export const marker = 1;\n");
  const app = createApp(mockedProvider);
  const req = (method: string, url: string, payload?: object) =>
    app.inject({ method, url, headers, payload });
  const selected = (
    await req("POST", "/api/v1/repository/select", { path: root })
  ).json();
  const graph = (
    await req("POST", "/api/v1/repository/analyze", {
      repositoryId: selected.repositoryId,
      revision: selected.revision,
    })
  ).json();
  await req("PUT", "/api/v1/ai/config", {
    enabled: true,
    consent: true,
    apiKey: "sk-test-only-key",
  });
  expect((await req("POST", "/api/v1/ai/test", {})).statusCode).toBe(200);
  const body = {
    repositoryId: graph.repositoryId,
    revision: graph.revision,
    manifest: graph.manifest,
    question: "Explain marker",
  };
  return { app, root, req, body };
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it("times out an unresponsive provider, aborts its signal and releases the active slot", async () => {
  const context = await setup();
  try {
    const hang = deferred();
    vi.stubGlobal("fetch", hang.fetcher);
    const originalTimeout = globalThis.setTimeout;
    let expire!: () => void;
    vi.spyOn(globalThis, "setTimeout").mockImplementation(((
      callback: (...args: unknown[]) => void,
      delay?: number,
      ...args: unknown[]
    ) => {
      if (delay === 12000) {
        expire = () => callback(...args);
        return originalTimeout(() => {}, 0);
      }
      return originalTimeout(callback, delay, ...args);
    }) as typeof setTimeout);
    const pending = context.req("POST", "/api/v1/ai/ask", context.body);
    await hang.whenStarted;
    expire();
    const response = await pending;
    expect(response.statusCode).toBe(504);
    expect(response.json()).toMatchObject({ error: { code: "AI_TIMEOUT" } });
    expect(hang.aborted).toBe(true);
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now + 2000);
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ choices: [{ message: { content: "{}" } }] }),
          ),
      ),
    );
    expect(
      (await context.req("POST", "/api/v1/ai/ask", context.body)).statusCode,
    ).not.toBe(429);
  } finally {
    await context.app.close();
    await rm(context.root, { recursive: true, force: true });
  }
});

it("aborts the provider after a real HTTP client disconnect", async () => {
  const context = await setup();
  try {
    const hang = deferred();
    vi.stubGlobal("fetch", hang.fetcher);
    const address = await context.app.listen({ host: "127.0.0.1", port: 0 });
    const client = httpRequest(`${address}/api/v1/ai/ask`, {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
    });
    client.on("error", () => {});
    client.end(JSON.stringify(context.body));
    await hang.whenStarted;
    client.destroy();
    await vi.waitFor(() => expect(hang.aborted).toBe(true), { timeout: 2000 });
  } finally {
    await context.app.close();
    await rm(context.root, { recursive: true, force: true });
  }
});

it.each([
  { enabled: false, consent: false },
  { enabled: true, consent: false },
])(
  "cancels generation and clears credentials on configuration change %j",
  async (change) => {
    const context = await setup();
    try {
      const hang = deferred();
      vi.stubGlobal("fetch", hang.fetcher);
      const pending = context.req("POST", "/api/v1/ai/ask", context.body);
      await hang.whenStarted;
      const changed = await context.req("PUT", "/api/v1/ai/config", change);
      expect(changed.json()).toMatchObject({ hasKey: false });
      expect(hang.aborted).toBe(true);
      const response = await pending;
      expect(response.statusCode).not.toBe(200);
      expect(response.json()).toMatchObject({
        error: { code: "AI_CANCELLED" },
      });
    } finally {
      await context.app.close();
      await rm(context.root, { recursive: true, force: true });
    }
  },
);

it("aborts an in-flight request when the destination changes", async () => {
  const context = await setup();
  try {
    const hang = deferred();
    vi.stubGlobal("fetch", hang.fetcher);
    const pending = context.req("POST", "/api/v1/ai/ask", context.body);
    await hang.whenStarted;
    const changed = await context.req("PUT", "/api/v1/ai/config", {
      enabled: true,
      consent: true,
      preset: "custom",
      protocol: "openai-compatible",
      endpointUrl: "https://ai.example/v1/chat/completions",
      providerName: "Example",
      model: "example-model",
      authMode: "bearer",
      apiKey: "vendor-key",
      local: false,
    });
    expect(changed.json()).toMatchObject({ consent: false, hasKey: false });
    expect(hang.aborted).toBe(true);
    expect((await pending).json()).toMatchObject({
      error: { code: "AI_CANCELLED" },
    });
  } finally {
    await context.app.close();
    await rm(context.root, { recursive: true, force: true });
  }
});
