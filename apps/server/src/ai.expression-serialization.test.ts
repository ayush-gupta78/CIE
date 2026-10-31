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

const providers = [
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
] as const;
const cases = [
  [
    "Makefile shell assignment in a comment",
    "unsafe.js",
    "// PASSWORD != synthetic-make-shell-secret\n",
    ["synthetic-make-shell-secret"],
  ],
  [
    "Makefile-style assignment in a comment",
    "unsafe.js",
    "// PASSWORD ?= synthetic-make-secret\n",
    ["synthetic-make-secret"],
  ],
  [
    "parenthesized literal",
    "unsafe.js",
    'const password = ("synthetic-parenthesized-secret");\n',
    ["synthetic-parenthesized-secret"],
  ],
  [
    "concatenated literals",
    "unsafe.js",
    'const password = "synthetic-concat-first" + "synthetic-concat-second";\n',
    ["synthetic-concat-first", "synthetic-concat-second"],
  ],
  [
    "environment nullish fallback",
    "unsafe.js",
    'const password = process.env.PASSWORD ?? "synthetic-fallback-secret";\n',
    ["synthetic-fallback-secret"],
  ],
] as const;

it.each(
  providers.flatMap((provider) =>
    cases.map((fixture) => [provider, fixture] as const),
  ),
)(
  "screens actual %s request for %s while preserving safe provenance",
  async ([preset, protocol, endpointUrl, model], [, path, source, secrets]) => {
    const root = await mkdtemp(join(tmpdir(), "cie-p0-serialization-"));
    const app = createApp();
    const req = (method: string, url: string, payload?: object) =>
      app.inject({
        method,
        url,
        payload,
        headers: { host: "127.0.0.1:3001", origin: "http://127.0.0.1:5173" },
      });
    const bodies: string[] = [];
    let safeId = "";
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
                { fileId: safeId, line: 2, quote: "ordinary evidence" },
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
      await writeFile(join(root, path), source);
      await writeFile(
        join(root, "safe.ts"),
        '// safe source\nexport const visible = "ordinary evidence";\n',
      );
      const selection = (
        await req("POST", "/api/v1/repository/select", { path: root })
      ).json();
      const analyzed = await req("POST", "/api/v1/repository/analyze", {
        repositoryId: selection.repositoryId,
        revision: selection.revision,
      });
      expect(analyzed.statusCode).toBe(200);
      const graph = analyzed.json();
      safeId = graph.files.find(
        (file: { path: string }) => file.path === "safe.ts",
      ).id;
      const unsafeId = graph.files.find(
        (file: { path: string }) => file.path === path,
      ).id;
      const config = {
        enabled: true,
        consent: true,
        preset,
        protocol,
        providerName: preset,
        endpointUrl,
        model,
        authMode: "bearer",
        apiKey: "synthetic-provider-key",
      };
      expect((await req("PUT", "/api/v1/ai/config", config)).statusCode).toBe(
        200,
      );
      expect(
        (await req("PUT", "/api/v1/ai/config", config)).json(),
      ).toMatchObject({ consent: true, hasKey: true });
      expect((await req("POST", "/api/v1/ai/test", {})).statusCode).toBe(200);
      const ask = {
        repositoryId: graph.repositoryId,
        revision: graph.revision,
        manifest: graph.manifest,
        question: "Explain ordinary evidence",
      };
      const result = await req("POST", "/api/v1/ai/ask", ask);
      expect(result.statusCode).toBe(200);
      expect(bodies).toHaveLength(2);
      const serialized = bodies[1];
      const payload = JSON.parse(serialized);
      const content =
        protocol === "gemini"
          ? payload.contents[0].parts[0].text
          : payload.messages.find(
              (message: { role: string }) => message.role === "user",
            ).content;
      const evidence = JSON.parse(content).evidence;
      expect(evidence).toContainEqual(
        expect.objectContaining({
          fileId: safeId,
          path: "safe.ts",
          lines: expect.arrayContaining([
            { line: 2, text: 'export const visible = "ordinary evidence";' },
          ]),
        }),
      );
      expect(result.json()).toMatchObject({
        status: "cited",
        citations: [
          {
            fileId: safeId,
            path: "safe.ts",
            line: 2,
            quote: "ordinary evidence",
            freshness: "verified",
          },
        ],
      });
      for (const secret of secrets)
        expect.soft(serialized).not.toContain(secret);
      await new Promise((resolve) => setTimeout(resolve, 1050));
      const before = bodies.length;
      const unsafeOnly = await req("POST", "/api/v1/ai/ask", {
        ...ask,
        fileId: unsafeId,
      });
      expect(unsafeOnly.statusCode).toBe(200);
      expect.soft(unsafeOnly.json()).toMatchObject({
        grounding: "insufficient",
        citations: [],
      });
      expect.soft(bodies).toHaveLength(before);
    } finally {
      await app.close();
      await rm(root, { recursive: true, force: true });
      vi.resetAllMocks();
    }
  },
);
