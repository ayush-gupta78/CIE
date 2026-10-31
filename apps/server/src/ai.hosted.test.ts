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
  ["xai", "https://api.x.ai/v1/chat/completions", "grok-4.7"],
  [
    "openrouter",
    "https://openrouter.ai/api/v1/chat/completions",
    "openai/gpt-4o-mini",
  ],
  [
    "nvidia",
    "https://integrate.api.nvidia.com/v1/chat/completions",
    "meta/llama-3.3-70b-instruct",
  ],
  [
    "groq",
    "https://api.groq.com/openai/v1/chat/completions",
    "llama-3.3-70b-versatile",
  ],
  [
    "deepseek",
    "https://api.deepseek.com/chat/completions",
    "deepseek-v4-flash",
  ],
  [
    "mistral",
    "https://api.mistral.ai/v1/chat/completions",
    "mistral-small-latest",
  ],
  ["cerebras", "https://api.cerebras.ai/v1/chat/completions", "qwen-3.8-27b"],
  [
    "together",
    "https://api.together.ai/v1/chat/completions",
    "Qwen/Qwen3.5-9B",
  ],
])(
  "%s exposes pinned discovery and chat using only vetted models",
  async (preset, endpoint, model) => {
    const app = createApp();
    const registry = (
      await app.inject({
        method: "GET",
        url: "/api/v1/ai/providers",
        headers: { host: "127.0.0.1:3001", origin: "http://127.0.0.1:5173" },
      })
    ).json().providers;
    expect(
      registry.find((p: { preset: string }) => p.preset === preset),
    ).toMatchObject({ endpointUrl: endpoint, model });
    await app.close();
    const config = validateProviderConfig({
      preset,
      endpoint,
      model,
      protocol: "openai-compatible",
      providerName: preset,
      authMode: "bearer",
      key: "example-key",
    });
    expect(() =>
      validateProviderConfig({
        ...config,
        endpoint: "https://evil.example/v1/chat/completions",
      }),
    ).toThrow();
    vi.mocked(lookup).mockResolvedValue([
      { address: "8.8.8.8", family: 4 },
    ] as never);
    const calls: string[] = [];
    vi.mocked(httpsRequest).mockImplementation(((
      url: URL,
      options: RequestOptions,
      callback: (res: IncomingMessage) => void,
    ) => {
      calls.push(`${options.method} ${url.href}`);
      expect((options.headers as Record<string, string>).authorization).toBe(
        "Bearer example-key",
      );
      options.lookup!(url.hostname, {}, (_error, address) =>
        expect(address).toBe("8.8.8.8"),
      );
      const req = new EventEmitter() as ClientRequest;
      req.setTimeout = vi.fn();
      req.destroy = vi.fn();
      req.end = ((body?: string) => {
        if (body)
          expect(JSON.parse(body)).toEqual({
            model,
            max_tokens: 64,
            messages: [{ role: "user", content: "test" }],
          });
        const res = new EventEmitter() as IncomingMessage;
        res.statusCode = 200;
        callback(res);
        const response = body
          ? { choices: [{ message: { content: '{"ok":true}' } }] }
          : preset === "together"
            ? [
                { id: model, type: "chat" },
                { id: "other/chat", type: "chat" },
                { id: "embedding-only", type: "embedding" },
              ]
            : { data: [{ id: model }, { id: "embedding-only" }] };
        queueMicrotask(() => {
          res.emit("data", Buffer.from(JSON.stringify(response)));
          res.emit("end");
        });
        return req;
      }) as ClientRequest["end"];
      return req;
    }) as typeof httpsRequest);
    expect(await discoverModels(config, new AbortController().signal)).toEqual({
      models: preset === "together" ? [model, "other/chat"].sort() : [model],
      truncated: false,
    });
    expect(
      await callProvider(
        config,
        [{ role: "user", content: "test" }],
        new AbortController().signal,
        "test",
      ),
    ).toEqual({ ok: true });
    expect(calls).toEqual([
      `GET ${endpoint.replace(/chat\/completions$/, "models")}`,
      `POST ${endpoint}`,
    ]);
    const api = createApp();
    const headers = { host: "127.0.0.1:3001", origin: "http://127.0.0.1:5173" };
    const put = (payload: object) =>
      api.inject({ method: "PUT", url: "/api/v1/ai/config", headers, payload });
    const settings = {
      enabled: true,
      consent: true,
      preset,
      endpointUrl: endpoint,
      model,
      protocol: "openai-compatible",
      providerName: preset,
      authMode: "bearer",
    };
    expect((await put(settings)).json()).toMatchObject({
      consent: false,
      hasKey: false,
    });
    expect(
      (await put({ ...settings, apiKey: "example-key" })).json(),
    ).toMatchObject({ consent: true, hasKey: true });
    const discovered = await api.inject({
      method: "POST",
      url: "/api/v1/ai/models",
      headers,
      payload: {},
    });
    expect(discovered.statusCode).toBe(200);
    expect(discovered.json()).toEqual({
      models: preset === "together" ? [model, "other/chat"].sort() : [model],
      truncated: false,
    });
    expect(
      (await put({ ...settings, model: discovered.json().models[0] })).json(),
    ).toMatchObject({ model, connectionStatus: "untested" });
    await api.close();
    vi.mocked(lookup).mockResolvedValue([
      { address: "8.8.8.8", family: 4 },
      { address: "127.0.0.1", family: 4 },
    ] as never);
    vi.mocked(httpsRequest).mockClear();
    await expect(
      discoverModels(config, new AbortController().signal),
    ).rejects.toThrow("AI provider unavailable");
    expect(httpsRequest).not.toHaveBeenCalled();
  },
);

it("discovers Fireworks serverless chat models through its catalog and pinned transport", async () => {
  const model = "accounts/fireworks/models/llama-v3p1-8b-instruct";
  const config = validateProviderConfig({
    preset: "fireworks",
    protocol: "openai-compatible",
    endpoint: "https://api.fireworks.ai/inference/v1/chat/completions",
    model,
    providerName: "Fireworks AI",
    authMode: "bearer",
    key: "example-key",
  });
  vi.mocked(lookup).mockResolvedValue([
    { address: "8.8.8.8", family: 4 },
  ] as never);
  const calls: string[] = [];
  vi.mocked(httpsRequest).mockImplementation(((
    url: URL,
    options: RequestOptions,
    callback: (res: IncomingMessage) => void,
  ) => {
    calls.push(`${options.method} ${url.href}`);
    expect((options.headers as Record<string, string>).authorization).toBe(
      "Bearer example-key",
    );
    options.lookup!(url.hostname, {}, (_error, address) =>
      expect(address).toBe("8.8.8.8"),
    );
    const req = new EventEmitter() as ClientRequest;
    req.setTimeout = vi.fn();
    req.destroy = vi.fn();
    req.end = ((body?: string) => {
      const res = new EventEmitter() as IncomingMessage;
      res.statusCode = 200;
      callback(res);
      const response = body
        ? { choices: [{ message: { content: '{"ok":true}' } }] }
        : url.search
          ? {
              models: [
                {
                  name: model,
                  supportsServerless: true,
                  conversationConfig: {},
                },
              ],
            }
          : {
              models: [
                {
                  name: model,
                  supportsServerless: false,
                  conversationConfig: {},
                },
              ],
              nextPageToken: "next",
            };
      queueMicrotask(() => {
        res.emit("data", Buffer.from(JSON.stringify(response)));
        res.emit("end");
      });
      return req;
    }) as ClientRequest["end"];
    return req;
  }) as typeof httpsRequest);
  expect(await discoverModels(config, new AbortController().signal)).toEqual({
    models: [model],
    truncated: false,
  });
  expect(
    await callProvider(
      config,
      [{ role: "user", content: "test" }],
      new AbortController().signal,
      "test",
    ),
  ).toEqual({ ok: true });
  expect(calls).toEqual([
    "GET https://api.fireworks.ai/v1/accounts/fireworks/models",
    "GET https://api.fireworks.ai/v1/accounts/fireworks/models?pageToken=next",
    "POST https://api.fireworks.ai/inference/v1/chat/completions",
  ]);
});
