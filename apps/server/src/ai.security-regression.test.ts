import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";

vi.mock("./aiProvider.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./aiProvider.js")>()),
  discoverModels: vi.fn(async () => ({
    models: ["prefix-example-key-suffix", "safe-model"],
    truncated: false,
  })),
}));
import { createApp } from "./app.js";

const headers = { host: "127.0.0.1:3001", origin: "http://127.0.0.1:5173" };
const key = "example-key";

it("screens model output and permits immediate connection test after discovery", async () => {
  const app = createApp(async () => ({ ok: true }));
  const req = (method: string, url: string, payload?: object) =>
    app.inject({ method, url, headers, payload });
  try {
    await req("PUT", "/api/v1/ai/config", {
      enabled: true,
      consent: true,
      preset: "gemini",
      protocol: "gemini",
      endpointUrl: "https://generativelanguage.googleapis.com/v1beta/models",
      model: "gemini-2.5-flash",
      authMode: "bearer",
    });
    await req("PUT", "/api/v1/ai/config", {
      enabled: true,
      consent: true,
      apiKey: key,
      providerName: `name-${key}`,
      model: `gemini-${key}`,
    });
    expect((await req("GET", "/api/v1/ai/config")).body).not.toContain(key);
    const models = await req("POST", "/api/v1/ai/models", {});
    expect((await req("POST", "/api/v1/ai/test", {})).statusCode).toBe(200);
    expect(models.body).not.toContain(key);
  } finally {
    await app.close();
  }
});

it("keeps a verified connection when a concurrent test is rejected", async () => {
  let release!: () => void;
  let started!: () => void;
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  const entered = new Promise<void>((resolve) => {
    started = resolve;
  });
  let calls = 0;
  const app = createApp(async () => {
    if (++calls === 2) {
      started();
      await waiting;
    }
    return { ok: true };
  });
  const req = (method: string, url: string, payload?: object) =>
    app.inject({ method, url, headers, payload });
  try {
    await req("PUT", "/api/v1/ai/config", {
      enabled: true,
      consent: true,
      apiKey: key,
    });
    expect((await req("POST", "/api/v1/ai/test", {})).statusCode).toBe(200);
    const pending = req("POST", "/api/v1/ai/test", {});
    await entered;
    expect((await req("POST", "/api/v1/ai/test", {})).statusCode).toBe(429);
    expect(
      (await req("GET", "/api/v1/ai/config")).json().connectionStatus,
    ).toBe("verified");
    release();
    await pending;
  } finally {
    release();
    await app.close();
  }
});

it("does not return an echoed credential in a grounded answer", async () => {
  const root = await mkdtemp(join(tmpdir(), "cie-ai-output-"));
  let fileId = "";
  let sent = "";
  const app = createApp(async (_config, messages, _signal, purpose) => {
    if (purpose === "test") return { ok: true };
    sent = JSON.stringify(messages);
    return {
      answer: `The key is ${key}`,
      citations: [{ fileId, line: 1, quote: "ordinary" }],
    };
  });
  const req = (method: string, url: string, payload?: object) =>
    app.inject({ method, url, headers, payload });
  try {
    await writeFile(
      join(root, "source.ts"),
      `export const ordinary = true;\n// https://host/?%74oken=encoded-secret&safe=yes\n// ${key}\n// ${String.raw`{"api\u005fkey":"escaped-json-secret"}`}\n`,
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
      apiKey: key,
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
    expect(answer.body).not.toContain(key);
    expect(sent).not.toContain("encoded-secret");
    expect(sent).not.toContain("escaped-json-secret");
    const evidence = JSON.parse(JSON.parse(sent)[1].content).evidence;
    expect(JSON.stringify(evidence)).toContain(
      JSON.stringify(String.raw`// {"api\u005fkey":"[redacted]"}`).slice(1, -1),
    );
    expect(sent).not.toContain(key);
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});

it("screens multiline credential values before selecting partial outbound evidence", async () => {
  const root = await mkdtemp(join(tmpdir(), "cie-multiline-redaction-"));
  let sent = "";
  const app = createApp(async (_config, messages, _signal, purpose) => {
    if (purpose === "test") return { ok: true };
    sent = JSON.stringify(messages);
    return { answer: "No answer", citations: [] };
  });
  const req = (method: string, url: string, payload?: object) =>
    app.inject({ method, url, headers, payload });
  const lines = [
    "export const data = {",
    String.raw`  "api\u005fkey":`,
    '    "synthetic-multiline-secret",',
    '  "password": {',
    '    "value": "synthetic-nested-secret",',
    '    "more": ["synthetic-array-secret"]',
    "  },",
    '  "accessToken": [',
    '    "synthetic-token-secret",',
    '    { "value": "synthetic-object-secret" }',
    "  ],",
    '  "visible": "ordinary evidence"',
    "}",
    ...Array.from({ length: 35 }, (_, i) => `// filler ${i}`),
  ];
  try {
    await writeFile(join(root, "source.ts"), lines.join("\n"));
    const selection = (
      await req("POST", "/api/v1/repository/select", { path: root })
    ).json();
    const graph = (
      await req("POST", "/api/v1/repository/analyze", {
        repositoryId: selection.repositoryId,
        revision: selection.revision,
      })
    ).json();
    const fileId = graph.files[0].id;
    await req("PUT", "/api/v1/ai/config", {
      enabled: true,
      consent: true,
      apiKey: key,
    });
    expect((await req("POST", "/api/v1/ai/test", {})).statusCode).toBe(200);
    expect(
      (
        await req("POST", "/api/v1/ai/ask", {
          repositoryId: graph.repositoryId,
          revision: graph.revision,
          manifest: graph.manifest,
          fileId,
          question: "Explain ordinary evidence",
        })
      ).statusCode,
    ).toBe(200);
    for (const secret of [
      "synthetic-multiline-secret",
      "synthetic-nested-secret",
      "synthetic-array-secret",
      "synthetic-token-secret",
      "synthetic-object-secret",
    ]) {
      expect(sent).not.toContain(secret);
    }
    const evidence = JSON.parse(JSON.parse(sent)[1].content).evidence[0].lines;
    expect(evidence).toContainEqual({
      line: 12,
      text: '  "visible": "ordinary evidence"',
    });
    expect(evidence.length).toBeLessThan(lines.length);
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});
