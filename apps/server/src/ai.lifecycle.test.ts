import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { createApp } from "./app.js";
import { mockedProvider } from "./aiTestProvider.fixture.js";

afterEach(() => vi.unstubAllGlobals());

it("rejects an in-flight answer after repository rescan", async () => {
  const root = await mkdtemp(join(tmpdir(), "cie-ai-stale-"));
  const app = createApp(mockedProvider);
  const headers = { host: "127.0.0.1:3001", origin: "http://127.0.0.1:5173" };
  const req = (method: string, url: string, payload?: object) =>
    app.inject({ method, url, headers, payload });
  try {
    await writeFile(join(root, "a.ts"), "export const marker = 1;\n");
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
      apiKey: "sk-test",
    });
    expect((await req("POST", "/api/v1/ai/test", {})).statusCode).toBe(200);
    let release!: () => void;
    const started = new Promise<void>((resolve) => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => {
          resolve();
          await new Promise<void>((done) => {
            release = done;
          });
          return new Response(
            JSON.stringify({
              choices: [
                {
                  message: {
                    content: JSON.stringify({
                      answer: "marker",
                      citations: [
                        { fileId: graph.files[0].id, line: 1, quote: "marker" },
                      ],
                    }),
                  },
                },
              ],
            }),
          );
        }),
      );
    });
    const pending = req("POST", "/api/v1/ai/ask", {
      repositoryId: graph.repositoryId,
      revision: graph.revision,
      manifest: graph.manifest,
      question: "marker",
    });
    await started;
    await req("POST", "/api/v1/repository/rescan", {});
    release();
    expect((await pending).json()).toMatchObject({
      error: { code: "STALE_REPOSITORY" },
    });
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});

it("rejects source edited while the model generates an answer", async () => {
  const root = await mkdtemp(join(tmpdir(), "cie-ai-source-race-"));
  const app = createApp(mockedProvider);
  const headers = { host: "127.0.0.1:3001", origin: "http://127.0.0.1:5173" };
  const req = (method: string, url: string, payload?: object) =>
    app.inject({ method, url, headers, payload });
  try {
    const path = join(root, "a.ts");
    await writeFile(path, "export const marker = 1;\n");
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
      apiKey: "sk-test-only-not-a-real-credential",
    });
    expect((await req("POST", "/api/v1/ai/test", {})).statusCode).toBe(200);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        await writeFile(path, "export const marker = 2;\n");
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    answer: "marker",
                    citations: [
                      { fileId: graph.files[0].id, line: 1, quote: "marker" },
                    ],
                  }),
                },
              },
            ],
          }),
        );
      }),
    );
    const response = await req("POST", "/api/v1/ai/ask", {
      repositoryId: graph.repositoryId,
      revision: graph.revision,
      manifest: graph.manifest,
      question: "Explain marker",
    });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ error: { code: "STALE_SOURCE" } });
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});
