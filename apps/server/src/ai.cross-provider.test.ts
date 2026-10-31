import { lookup } from "node:dns/promises";
import { EventEmitter } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import type { ClientRequest, IncomingMessage, RequestOptions } from "node:http";
import { request as httpsRequest } from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { createApp } from "./app.js";

vi.mock("node:dns/promises", async (original) => ({
  ...(await original()),
  lookup: vi.fn(),
}));
vi.mock("node:https", async (original) => ({
  ...(await original()),
  request: vi.fn(),
}));

it.each([
  [
    "sambanova",
    "openai-compatible",
    "https://api.sambanova.ai/v1/chat/completions",
    "Meta-Llama-3.3-70B-Instruct",
  ],
  [
    "novita",
    "openai-compatible",
    "https://api.novita.ai/openai/v1/chat/completions",
    "inclusionai/ling-3.0-tiny",
  ],
  ["cohere", "cohere", "https://api.cohere.com/v2/chat", "command-a"],
  [
    "huggingface",
    "openai-compatible",
    "https://router.huggingface.co/v1/chat/completions",
    "org/model",
  ],
  [
    "fireworks",
    "openai-compatible",
    "https://api.fireworks.ai/inference/v1/chat/completions",
    "accounts/fireworks/models/llama-v3p1-8b-instruct",
  ],
  [
    "openai",
    "openai-compatible",
    "https://api.openai.com/v1/chat/completions",
    "gpt-4o-mini",
  ],
  [
    "deepseek",
    "openai-compatible",
    "https://api.deepseek.com/chat/completions",
    "deepseek-v4-flash",
  ],
  [
    "mistral",
    "openai-compatible",
    "https://api.mistral.ai/v1/chat/completions",
    "mistral-small-latest",
  ],
  [
    "cerebras",
    "openai-compatible",
    "https://api.cerebras.ai/v1/chat/completions",
    "qwen-3.8-27b",
  ],
  [
    "together",
    "openai-compatible",
    "https://api.together.ai/v1/chat/completions",
    "Qwen/Qwen3.5-9B",
  ],
  [
    "xai",
    "openai-compatible",
    "https://api.x.ai/v1/chat/completions",
    "grok-4.7",
  ],
  [
    "anthropic",
    "anthropic",
    "https://api.anthropic.com/v1/messages",
    "claude-sonnet-4-5",
  ],
  [
    "gemini",
    "gemini",
    "https://generativelanguage.googleapis.com/v1beta/models",
    "gemini-2.5-flash",
  ],
  [
    "openrouter",
    "openai-compatible",
    "https://openrouter.ai/api/v1/chat/completions",
    "openai/gpt-4o-mini",
  ],
  [
    "nvidia",
    "openai-compatible",
    "https://integrate.api.nvidia.com/v1/chat/completions",
    "meta/llama-3.3-70b-instruct",
  ],
  [
    "groq",
    "openai-compatible",
    "https://api.groq.com/openai/v1/chat/completions",
    "llama-3.3-70b-versatile",
  ],
])(
  "grounds %s responses through the guarded transport",
  async (preset, protocol, endpoint, model) => {
    const root = await mkdtemp(join(tmpdir(), "cie-cross-provider-"));
    const app = createApp();
    const headers = { host: "127.0.0.1:3001", origin: "http://127.0.0.1:5173" };
    const req = (method: string, url: string, payload?: object) =>
      app.inject({ method, url, headers, payload });
    const calls: {
      url: string;
      options: RequestOptions;
      body: {
        contents: { parts: { text: string }[] }[];
        messages: { role: string; content: string }[];
        generationConfig: { maxOutputTokens: number };
        max_tokens: number;
        model: string;
      };
      pinned: unknown;
    }[] = [];
    let fileId = "";
    let fabricated = false;
    vi.mocked(lookup).mockResolvedValue([
      { address: "8.8.8.8", family: 4 },
    ] as never);
    vi.mocked(httpsRequest).mockImplementation(((
      url: URL,
      options: RequestOptions,
      callback: (res: IncomingMessage) => void,
    ) => {
      const request = new EventEmitter() as ClientRequest;
      request.setTimeout = vi.fn();
      request.destroy = vi.fn();
      request.end = ((body: string) => {
        let pinned: unknown;
        options.lookup!(url.hostname, {}, (_error, address) => {
          pinned = address;
        });
        const payload = JSON.parse(body);
        calls.push({ url: url.href, options, body: payload, pinned });
        const raw = JSON.stringify(payload);
        const answer = raw.includes("Connectivity test. No repository content.")
          ? { ok: true }
          : {
              answer: "The source exports marker.",
              citations: [
                {
                  fileId: fabricated ? "0".repeat(64) : fileId,
                  line: 1,
                  quote: "export const marker",
                },
              ],
            };
        const text = JSON.stringify(answer);
        const response =
          protocol === "cohere"
            ? {
                message: { content: [{ type: "text", text }] },
                finish_reason: "COMPLETE",
              }
            : protocol === "anthropic"
              ? { content: [{ type: "text", text }] }
              : protocol === "gemini"
                ? { candidates: [{ content: { parts: [{ text }] } }] }
                : { choices: [{ message: { content: text } }] };
        const res = new EventEmitter() as IncomingMessage;
        res.statusCode = 200;
        callback(res);
        queueMicrotask(() => {
          res.emit("data", Buffer.from(JSON.stringify(response)));
          res.emit("end");
        });
        return request;
      }) as ClientRequest["end"];
      return request;
    }) as typeof httpsRequest);
    try {
      await writeFile(join(root, "a.ts"), "export const marker = 1;\n");
      const selected = (
        await req("POST", "/api/v1/repository/select", { path: root })
      ).json();
      const analyzed = await req("POST", "/api/v1/repository/analyze", {
        repositoryId: selected.repositoryId,
        revision: selected.revision,
      });
      expect(analyzed.statusCode).toBe(200);
      const graph = analyzed.json();
      fileId = graph.files[0].id;
      const settings = {
        enabled: true,
        consent: true,
        preset,
        protocol,
        providerName: preset,
        endpointUrl: endpoint,
        model,
        authMode: "bearer",
        apiKey: "example-key",
      };
      await req("PUT", "/api/v1/ai/config", settings);
      const configured = await req("PUT", "/api/v1/ai/config", settings);
      expect(configured.json()).toMatchObject({ consent: true, hasKey: true });
      expect((await req("POST", "/api/v1/ai/test", {})).statusCode).toBe(200);
      const testPayload = JSON.stringify(calls[0].body);
      expect(testPayload).toContain(
        "Connectivity test. No repository content.",
      );
      expect(testPayload).not.toContain("export const marker");
      const body = {
        repositoryId: graph.repositoryId,
        revision: graph.revision,
        manifest: graph.manifest,
        question: "Explain marker",
        fileId,
      };
      const result = await req("POST", "/api/v1/ai/ask", body);
      expect(result.statusCode).toBe(200);
      expect(result.json()).toMatchObject({
        status: "cited",
        citations: [
          {
            fileId,
            path: "a.ts",
            line: 1,
            startLine: 1,
            endLine: 1,
            quote: "export const marker",
            freshness: "verified",
          },
        ],
      });
      const sent = calls[1];
      expect(sent.url).toBe(
        protocol === "gemini"
          ? `${endpoint}/${model}:generateContent`
          : endpoint,
      );
      expect(sent.options.method).toBe("POST");
      expect(sent.pinned).toBe("8.8.8.8");
      const auth = sent.options.headers as Record<string, string>;
      expect(
        auth[
          protocol === "anthropic"
            ? "x-api-key"
            : protocol === "gemini"
              ? "x-goog-api-key"
              : "authorization"
        ],
      ).toBe(
        protocol === "openai-compatible" || protocol === "cohere"
          ? "Bearer example-key"
          : "example-key",
      );
      const content =
        protocol === "gemini"
          ? sent.body.contents[0].parts[0].text
          : sent.body.messages.find((m: { role: string }) => m.role === "user")
              .content;
      const evidence = JSON.parse(content);
      expect(evidence.question).toBe("Explain marker");
      expect(evidence.evidence).toHaveLength(1);
      expect(evidence.evidence[0]).toMatchObject({
        fileId,
        path: "a.ts",
        lines: [{ line: 1, text: "export const marker = 1;" }],
      });
      expect(
        protocol === "gemini"
          ? sent.body.generationConfig.maxOutputTokens
          : sent.body.max_tokens,
      ).toBe(450);
      if (protocol !== "gemini") expect(sent.body.model).toBe(model);
      fabricated = true;
      await new Promise((resolve) => setTimeout(resolve, 1050));
      const rejected = await req("POST", "/api/v1/ai/ask", body);
      expect(rejected.statusCode).toBe(200);
      expect(rejected.json()).toMatchObject({
        grounding: "insufficient",
        citations: [],
      });
    } finally {
      await app.close();
      await rm(root, { recursive: true, force: true });
      vi.resetAllMocks();
    }
  },
);
