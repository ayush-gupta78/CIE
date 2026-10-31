import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { createApp } from "./app.js";

const headers = { host: "127.0.0.1:3001", origin: "http://127.0.0.1:5173" };

it("does not infer when all evidence consists of redaction placeholders", async () => {
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
    await writeFile(join(root, "source.ts"), "sk-abcdefghijklmnop");
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

it("marks partial lines truncated and refuses citations to unsent suffixes", async () => {
  const root = await mkdtemp(join(tmpdir(), "cie-boundary-"));
  let sent = "";
  let fileId = "";
  const app = createApp(async (_config, messages, _signal, purpose) => {
    if (purpose === "test") return { ok: true };
    sent = messages[1].content;
    return {
      answer: "guessed",
      citations: [{ fileId, line: 1, quote: "hidden-suffix" }],
    };
  });
  const req = (method: string, url: string, payload?: object) =>
    app.inject({ method, url, headers, payload });
  try {
    await writeFile(
      join(root, "source.ts"),
      `export const ordinary = "${"x".repeat(200)}hidden-suffix";`,
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
      apiKey: "example-key",
    });
    expect((await req("POST", "/api/v1/ai/test", {})).statusCode).toBe(200);
    const response = await req("POST", "/api/v1/ai/ask", {
      repositoryId: graph.repositoryId,
      revision: graph.revision,
      manifest: graph.manifest,
      fileId,
      question: "Explain ordinary",
    });
    expect(sent).not.toContain("hidden-suffix");
    expect(JSON.parse(sent).evidence[0].lines[0].line).toBe(1);
    expect(response.json().grounding).toBe("insufficient");
    expect(response.json().warnings.join(" ")).toContain("truncated");
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});

it("screens question, relationship specifiers and sensitive paths before serialization", async () => {
  const root = await mkdtemp(join(tmpdir(), "cie-metadata-"));
  let sent = "";
  const app = createApp(async (_config, messages, _signal, purpose) => {
    if (purpose === "test") return { ok: true };
    sent = messages[1].content;
    return { answer: "no answer", citations: [] };
  });
  const req = (method: string, url: string, payload?: object) =>
    app.inject({ method, url, headers, payload });
  try {
    await writeFile(
      join(root, "caller.ts"),
      "import './api_key=metadata-secret';\nexport const ordinary = true;",
    );
    await writeFile(
      join(root, "api_key=metadata-secret.ts"),
      "export const visible = true;",
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
    const fileId = graph.files.find(
      (file: { path: string }) => file.path === "caller.ts",
    ).id;
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
      fileId,
      question: "Explain ordinary password=question-secret",
    });
    expect(response.statusCode).toBe(200);
    expect(sent).not.toContain("metadata-secret");
    expect(sent).not.toContain("question-secret");
    const payload = JSON.parse(sent);
    expect(payload.evidence.map((item: { path: string }) => item.path)).toEqual(
      ["caller.ts"],
    );
    expect(payload.relationships[0].specifier).toContain("[redacted]");
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});
