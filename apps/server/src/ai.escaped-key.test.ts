import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { createApp } from "./app.js";

const headers = { host: "127.0.0.1:3001", origin: "http://127.0.0.1:5173" };

it("preserves configuration enums when a short key overlaps their text", async () => {
  const app = createApp();
  try {
    const result = await app.inject({
      method: "PUT",
      url: "/api/v1/ai/config",
      headers,
      payload: { enabled: true, consent: true, apiKey: "a" },
    });
    expect(result.json()).toMatchObject({
      preset: "openai",
      protocol: "openai-compatible",
      authMode: "bearer",
      connectionStatus: "untested",
    });
  } finally {
    await app.close();
  }
});

it.each(['example"key', "example\\key"])(
  "does not disclose escaped key in provider answer",
  async (secret) => {
    const root = await mkdtemp(join(tmpdir(), "cie-ai-escaped-"));
    let fileId = "";
    const app = createApp(async (_config, _messages, _signal, purpose) =>
      purpose === "test"
        ? { ok: true }
        : {
            answer: `Credential: ${secret}`,
            citations: [{ fileId, line: 1, quote: "ordinary" }],
          },
    );
    const req = (method: string, url: string, payload?: object) =>
      app.inject({ method, url, headers, payload });
    try {
      await writeFile(
        join(root, "source.ts"),
        "export const ordinary = true;\n",
      );
      const selection = (
        await req("POST", "/api/v1/repository/select", { path: root })
      ).json();
      const graph = (
        await req("POST", "/api/v1/repository/analyze", {
          repositoryId: selection.repositoryId,
          revision: selection.revision,
        })
      ).json();
      fileId = graph.files[0].id;
      await req("PUT", "/api/v1/ai/config", {
        enabled: true,
        consent: true,
        apiKey: secret,
      });
      expect((await req("POST", "/api/v1/ai/test", {})).statusCode).toBe(200);
      const answer = await req("POST", "/api/v1/ai/ask", {
        repositoryId: graph.repositoryId,
        revision: graph.revision,
        manifest: graph.manifest,
        fileId,
        question: "Explain ordinary",
      });
      expect(answer.statusCode).toBe(200);
      expect(answer.json().answer).not.toContain(secret);
    } finally {
      await app.close();
      await rm(root, { recursive: true, force: true });
    }
  },
);
