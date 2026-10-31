import { EventEmitter } from "node:events";
import type { ClientRequest, IncomingMessage, RequestOptions } from "node:http";
import { lookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import { expect, it, vi } from "vitest";
import {
  callProvider,
  discoverModels,
  validateProviderConfig,
} from "./aiProvider.js";

vi.mock("node:dns/promises", async (original) => ({
  ...(await original()),
  lookup: vi.fn(),
}));
vi.mock("node:https", async (original) => ({
  ...(await original()),
  request: vi.fn(),
}));

it.each([
  {
    preset: "anthropic",
    endpoint: "https://api.anthropic.com/v1/messages",
    model: "claude-sonnet-4-5",
    header: "x-api-key",
    response: { content: [{ type: "text", text: '{"ok":true}' }] },
  },
  {
    preset: "gemini",
    endpoint: "https://generativelanguage.googleapis.com/v1beta/models",
    model: "gemini-2.5-flash",
    header: "x-goog-api-key",
    response: {
      candidates: [{ content: { parts: [{ text: '{"ok":true}' }] } }],
    },
  },
])(
  "sends $preset native requests over pinned transport",
  async ({ preset, endpoint, model, header, response }) => {
    vi.mocked(lookup).mockResolvedValue([
      { address: "8.8.8.8", family: 4 },
    ] as never);
    vi.mocked(httpsRequest).mockImplementation(((
      url: URL,
      options: RequestOptions,
      callback: (res: IncomingMessage) => void,
    ) => {
      expect(url.hostname).toBe(new URL(endpoint).hostname);
      expect((options.headers as Record<string, string>)[header]).toBe(
        "example-key",
      );
      options.lookup!(url.hostname, {}, (_error, address) =>
        expect(address).toBe("8.8.8.8"),
      );
      const req = new EventEmitter() as ClientRequest;
      req.setTimeout = vi.fn();
      req.destroy = vi.fn();
      req.end = ((body: string) => {
        const payload = JSON.parse(body);
        expect(payload).toEqual(
          preset === "anthropic"
            ? {
                model,
                max_tokens: 64,
                temperature: 0,
                system: "instructions",
                messages: [{ role: "user", content: "untrusted evidence" }],
              }
            : {
                systemInstruction: { parts: [{ text: "instructions" }] },
                contents: [
                  { role: "user", parts: [{ text: "untrusted evidence" }] },
                ],
                generationConfig: {
                  temperature: 0,
                  maxOutputTokens: 64,
                  responseMimeType: "application/json",
                },
              },
        );
        expect(url.href).toBe(
          preset === "anthropic"
            ? endpoint
            : `${endpoint}/${model}:generateContent`,
        );
        expect(options.method).toBe("POST");
        const res = new EventEmitter() as IncomingMessage;
        res.statusCode = 200;
        callback(res);
        queueMicrotask(() => {
          res.emit("data", Buffer.from(JSON.stringify(response)));
          res.emit("end");
        });
        return req;
      }) as ClientRequest["end"];
      return req;
    }) as typeof httpsRequest);
    const config = validateProviderConfig({
      preset,
      protocol: preset,
      endpoint,
      model,
      providerName: preset,
      authMode: "bearer",
      key: "example-key",
    });
    await expect(
      callProvider(
        config,
        [
          { role: "system", content: "instructions" },
          { role: "user", content: "untrusted evidence" },
        ],
        new AbortController().signal,
        "test",
      ),
    ).resolves.toEqual({ ok: true });
    expect(() =>
      validateProviderConfig({
        ...config,
        endpoint: "https://evil.example/v1",
      }),
    ).toThrow();
  },
);

it.each(["anthropic", "gemini"] as const)(
  "guards and translates %s errors",
  async (preset) => {
    const config = validateProviderConfig({
      preset,
      protocol: preset,
      endpoint:
        preset === "anthropic"
          ? "https://api.anthropic.com/v1/messages"
          : "https://generativelanguage.googleapis.com/v1beta/models",
      model: "model-one",
      providerName: preset,
      authMode: "bearer",
      key: "example-key",
    });
    const signal = new AbortController().signal;
    vi.mocked(lookup).mockResolvedValue([
      { address: "8.8.8.8", family: 4 },
      { address: "127.0.0.1", family: 4 },
    ] as never);
    vi.mocked(httpsRequest).mockClear();
    await expect(callProvider(config, [], signal)).rejects.toThrow(
      "AI provider unavailable.",
    );
    expect(httpsRequest).not.toHaveBeenCalled();
    vi.mocked(lookup).mockResolvedValue([
      { address: "8.8.8.8", family: 4 },
    ] as never);
    let status = 401;
    vi.mocked(httpsRequest).mockImplementation(((
      _url: URL,
      _options: RequestOptions,
      callback: (res: IncomingMessage) => void,
    ) => {
      const req = new EventEmitter() as ClientRequest;
      req.setTimeout = vi.fn();
      req.destroy = vi.fn();
      req.end = (() => {
        const res = new EventEmitter() as IncomingMessage;
        res.statusCode = status;
        callback(res);
        queueMicrotask(() => {
          res.emit("data", Buffer.from("sensitive provider text"));
          res.emit("end");
        });
        return req;
      }) as ClientRequest["end"];
      return req;
    }) as typeof httpsRequest);
    for (const [code, expected] of [
      [401, "AI_AUTH"],
      [403, "AI_FORBIDDEN"],
      [404, "AI_NOT_FOUND"],
      [429, "AI_RATE_LIMIT"],
    ] as const) {
      status = code;
      await expect(callProvider(config, [], signal)).rejects.toMatchObject({
        code: expected,
      });
      await expect(discoverModels(config, signal)).rejects.toMatchObject({
        code: expected,
      });
    }
    status = 302;
    await expect(callProvider(config, [], signal)).rejects.toThrow(
      "AI provider unavailable.",
    );
    status = 200;
    await expect(callProvider(config, [], signal)).rejects.toThrow(
      "AI response invalid.",
    );
  },
);

it("discovers only Gemini generateContent models across pages", async () => {
  vi.mocked(lookup).mockResolvedValue([
    { address: "8.8.8.8", family: 4 },
  ] as never);
  const urls: string[] = [];
  vi.mocked(httpsRequest).mockImplementation(((
    url: URL,
    options: RequestOptions,
    callback: (res: IncomingMessage) => void,
  ) => {
    expect(options.method).toBe("GET");
    urls.push(url.href);
    const req = new EventEmitter() as ClientRequest;
    req.setTimeout = vi.fn();
    req.destroy = vi.fn();
    req.end = (() => {
      const res = new EventEmitter() as IncomingMessage;
      res.statusCode = 200;
      callback(res);
      const payload =
        urls.length === 1
          ? {
              models: [
                {
                  name: "models/embed",
                  supportedGenerationMethods: ["embedContent"],
                },
                {
                  name: "models/gemini-one",
                  supportedGenerationMethods: ["generateContent"],
                },
              ],
              nextPageToken: "next",
            }
          : {
              models: [
                {
                  name: "models/gemini-two",
                  supportedGenerationMethods: ["generateContent"],
                },
              ],
            };
      queueMicrotask(() => {
        res.emit("data", Buffer.from(JSON.stringify(payload)));
        res.emit("end");
      });
      return req;
    }) as ClientRequest["end"];
    return req;
  }) as typeof httpsRequest);
  const config = validateProviderConfig({
    preset: "gemini",
    protocol: "gemini",
    endpoint: "https://generativelanguage.googleapis.com/v1beta/models",
    model: "gemini-2.5-flash",
    providerName: "Gemini",
    authMode: "bearer",
    key: "example-key",
  });
  expect(await discoverModels(config, new AbortController().signal)).toEqual({
    models: ["gemini-one", "gemini-two"],
    truncated: false,
  });
  expect(urls[1]).toContain("pageToken=next");
});

it("discovers Anthropic models with the native header and pagination", async () => {
  vi.mocked(lookup).mockResolvedValue([
    { address: "8.8.8.8", family: 4 },
  ] as never);
  const urls: string[] = [];
  vi.mocked(httpsRequest).mockImplementation(((
    url: URL,
    options: RequestOptions,
    callback: (res: IncomingMessage) => void,
  ) => {
    expect(
      (options.headers as Record<string, string>)["anthropic-version"],
    ).toBe("2023-06-01");
    expect((options.headers as Record<string, string>)["x-api-key"]).toBe(
      "example-key",
    );
    urls.push(url.href);
    const req = new EventEmitter() as ClientRequest;
    req.setTimeout = vi.fn();
    req.destroy = vi.fn();
    req.end = (() => {
      const res = new EventEmitter() as IncomingMessage;
      res.statusCode = 200;
      callback(res);
      const payload =
        urls.length === 1
          ? {
              data: [{ id: "claude-one" }],
              has_more: true,
              last_id: "claude-one",
            }
          : { data: [{ id: "claude-two" }], has_more: false };
      queueMicrotask(() => {
        res.emit("data", Buffer.from(JSON.stringify(payload)));
        res.emit("end");
      });
      return req;
    }) as ClientRequest["end"];
    return req;
  }) as typeof httpsRequest);
  const config = validateProviderConfig({
    preset: "anthropic",
    protocol: "anthropic",
    endpoint: "https://api.anthropic.com/v1/messages",
    model: "claude-sonnet-4-5",
    providerName: "Anthropic",
    authMode: "bearer",
    key: "example-key",
  });
  expect(await discoverModels(config, new AbortController().signal)).toEqual({
    models: ["claude-one", "claude-two"],
    truncated: false,
  });
  expect(urls[0]).toBe("https://api.anthropic.com/v1/models");
  expect(urls[1]).toContain("after_id=claude-one");
});
