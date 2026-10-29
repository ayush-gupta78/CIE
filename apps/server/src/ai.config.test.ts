import { expect, it } from "vitest";
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "./app.js";

const headers = { host: "127.0.0.1:3001", origin: "http://127.0.0.1:5173" };
it("accepts custom compatible provider settings and renews consent for a changed destination", async () => {
  const app = createApp();
  try {
    const put = (payload: object) =>
      app.inject({ method: "PUT", url: "/api/v1/ai/config", headers, payload });
    const custom = {
      enabled: true,
      consent: true,
      providerName: "Example",
      protocol: "openai-compatible",
      endpointUrl: "https://ai.example/v1/chat/completions",
      model: "example-model",
      authMode: "bearer",
      preset: "custom",
      apiKey: "vendor-key",
    };
    const initial = await put(custom);
    expect(initial.statusCode).toBe(200);
    expect(initial.json()).toMatchObject({
      endpointUrl: custom.endpointUrl,
      model: "example-model",
      consent: false,
      hasKey: false,
    });
    const renewed = await put({
      ...custom,
      consent: true,
      apiKey: "replacement-vendor-key",
    });
    expect(renewed.json()).toMatchObject({
      enabled: true,
      consent: true,
      hasKey: true,
    });
    expect(JSON.stringify(renewed.json())).not.toContain(
      "replacement-vendor-key",
    );
    const local = await put({
      enabled: true,
      consent: true,
      providerName: "Local model",
      protocol: "openai-compatible",
      endpointUrl: "http://127.0.0.1:11434/v1/chat/completions",
      model: "local-model",
      authMode: "none",
      preset: "local",
    });
    expect(local.json()).toMatchObject({
      local: true,
      consent: false,
      hasKey: false,
    });
    expect((await put({ enabled: true, consent: true })).json()).toMatchObject({
      enabled: true,
      consent: true,
      local: true,
    });
    expect(
      (
        await put({
          enabled: true,
          consent: true,
          endpointUrl: "http://169.254.169.254/metadata",
          preset: "local",
        })
      ).statusCode,
    ).toBe(400);
  } finally {
    await app.close();
  }
});

it("answers through a deliberately configured unauthenticated loopback-compatible provider", async () => {
  let transmitted = "";
  let fileId = "";
  const provider = createServer(async (req, res) => {
    expect(req.headers.authorization).toBeUndefined();
    for await (const chunk of req) transmitted += chunk;
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                answer: "The source exports marker.",
                citations: [{ fileId, line: 1, quote: "export const marker" }],
              }),
            },
          },
        ],
      }),
    );
  });
  const root = await mkdtemp(join(tmpdir(), "cie-compatible-"));
  const app = createApp();
  provider.listen(0, "127.0.0.1");
  await once(provider, "listening");
  try {
    const address = provider.address();
    if (!address || typeof address === "string")
      throw new Error("No local provider address");
    await writeFile(join(root, "a.ts"), "export const marker = 1;\n");
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
    fileId = graph.files[0].id;
    const config = {
      enabled: true,
      consent: true,
      preset: "local",
      local: true,
      protocol: "openai-compatible",
      providerName: "Local test",
      endpointUrl: `http://127.0.0.1:${address.port}/v1/chat/completions`,
      model: "test-model",
      authMode: "none",
    };
    expect(
      (await req("PUT", "/api/v1/ai/config", config)).json(),
    ).toMatchObject({ consent: false, hasKey: false });
    expect(
      (await req("PUT", "/api/v1/ai/config", config)).json(),
    ).toMatchObject({ consent: true, hasKey: false });
    const answer = await req("POST", "/api/v1/ai/ask", {
      repositoryId: graph.repositoryId,
      revision: graph.revision,
      manifest: graph.manifest,
      question: "Explain marker",
    });
    expect(answer.statusCode).toBe(200);
    expect(answer.json()).toMatchObject({
      status: "cited",
      citations: [{ fileId, line: 1 }],
    });
    expect(transmitted).toContain("export const marker");
  } finally {
    await app.close();
    await new Promise<void>((resolve) => provider.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  }
});
