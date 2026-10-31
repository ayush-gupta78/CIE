import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { createApp } from "./app.js";

const headers = { host: "127.0.0.1:3001", origin: "http://127.0.0.1:5173" };

it("does not infer when all evidence consists of redaction placeholders and syntax only", async () => {
  const root = await mkdtemp(join(tmpdir(), "cie-boundary-"));
  let calls = 0;
  const app = createApp(async (_config, _messages, _signal, purpose) => {
    if (purpose === "test") return { ok: true };
    calls++;
    return { answer: "guessed", citations: [] };
  });
  const req = (method: string, url: string, payload?: object) =>
    app.inject({ method, url, headers, payload });
  try {
    await writeFile(join(root, "source.ts"), '(("sk-abcdefghijklmnop"));');
    const selection = (
      await req("POST", "/api/v1/repository/select", { path: root })
    ).json();
    const graph = (
      await req("POST", "/api/v1/repository/analyze", {
        repositoryId: selection.repositoryId,
        revision: selection.revision,
      })
    ).json();
    await req("PUT", "/api/v1/ai/config", {
      enabled: true,
      consent: true,
      apiKey: "example-key",
    });
    expect((await req("POST", "/api/v1/ai/test", {})).statusCode).toBe(200);
    const response = await req("POST", "/api/v1/ai/ask", {
      repositoryId: graph.repositoryId,
      revision: graph.revision,
      manifest: graph.manifest,
      fileId: graph.files[0].id,
      question: "Explain",
    });
    expect(response.json().grounding).toBe("insufficient");
    expect(calls).toBe(0);
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});
