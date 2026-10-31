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
    "gemini",
    "gemini",
    "https://generativelanguage.googleapis.com/v1beta/models",
    "gemini-2.5-flash",
  ],
  [
    "anthropic",
    "anthropic",
    "https://api.anthropic.com/v1/messages",
    "claude-sonnet-4-5",
  ],
  [
    "openai",
    "openai-compatible",
    "https://api.openai.com/v1/chat/completions",
    "gpt-4o-mini",
  ],
])(
  "sanitizes repository evidence in serialized %s requests",
  async (preset, protocol, endpointUrl, model) => {
    const root = await mkdtemp(join(tmpdir(), "cie-serialization-security-"));
    const app = createApp();
    const req = (method: string, url: string, payload?: object) =>
      app.inject({
        method,
        url,
        headers: { host: "127.0.0.1:3001", origin: "http://127.0.0.1:5173" },
        payload,
      });
    const bodies: string[] = [];
    let fileId = "";
    let placeholder = false;
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
        expect(pinned).toBe("8.8.8.8");
        bodies.push(body);
        const answer = body.includes(
          "Connectivity test. No repository content.",
        )
          ? { ok: true }
          : {
              answer: "Ordinary evidence.",
              citations: [
                {
                  fileId,
                  line: placeholder ? 3 : 12,
                  quote: placeholder ? "[redacted]" : "ordinary evidence",
                },
              ],
            };
        const text = JSON.stringify(answer);
        const response =
          protocol === "gemini"
            ? { candidates: [{ content: { parts: [{ text }] } }] }
            : protocol === "anthropic"
              ? { content: [{ type: "text", text }] }
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
        "};",
        ...Array.from({ length: 35 }, (_, i) => `// filler ${i}`),
      ];
      await writeFile(join(root, "source.ts"), lines.join("\n"));
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
        endpointUrl,
        model,
        authMode: "bearer",
        apiKey: "example-key",
      };
      expect((await req("PUT", "/api/v1/ai/config", settings)).statusCode).toBe(
        200,
      );
      const configured = await req("PUT", "/api/v1/ai/config", settings);
      expect(configured.json()).toMatchObject({ consent: true, hasKey: true });
      expect((await req("POST", "/api/v1/ai/test", {})).statusCode).toBe(200);
      const ask = {
        repositoryId: graph.repositoryId,
        revision: graph.revision,
        manifest: graph.manifest,
        fileId,
        question: "Explain ordinary evidence",
      };
      const result = await req("POST", "/api/v1/ai/ask", ask);
      expect(result.statusCode).toBe(200);
      expect(bodies).toHaveLength(2);
      const serialized = bodies[1];
      for (const secret of [
        "synthetic-multiline-secret",
        "synthetic-nested-secret",
        "synthetic-array-secret",
        "synthetic-token-secret",
        "synthetic-object-secret",
      ]) {
        expect(serialized).not.toContain(secret);
      }
      const payload = JSON.parse(serialized);
      const content =
        protocol === "gemini"
          ? payload.contents[0].parts[0].text
          : payload.messages.find(
              (message: { role: string }) => message.role === "user",
            ).content;
      const evidence = JSON.parse(content).evidence[0];
      expect(evidence).toMatchObject({ fileId, path: "source.ts" });
      expect(evidence.lines).toContainEqual({
        line: 12,
        text: '  "visible": "ordinary evidence"',
      });
      expect(evidence.lines.length).toBeLessThan(lines.length);
      expect(result.json()).toMatchObject({
        status: "cited",
        citations: [
          {
            fileId,
            path: "source.ts",
            line: 12,
            quote: "ordinary evidence",
            freshness: "verified",
          },
        ],
      });
      placeholder = true;
      await new Promise((resolve) => setTimeout(resolve, 1050));
      const rejected = await req("POST", "/api/v1/ai/ask", ask);
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
