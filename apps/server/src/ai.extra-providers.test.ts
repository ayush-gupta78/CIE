import { EventEmitter } from "node:events";
import type { ClientRequest, IncomingMessage, RequestOptions } from "node:http";
import { lookup } from "node:dns/promises";
import { request } from "node:https";
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
  [
    "cohere",
    "cohere",
    "https://api.cohere.com/v2/chat",
    "command-a",
    {
      models: [
        { name: "command-a", endpoints: ["chat"] },
        { name: "embed", endpoints: ["embed"] },
      ],
    },
    {
      message: { content: [{ type: "text", text: '{"ok":true}' }] },
      finish_reason: "COMPLETE",
    },
    "https://api.cohere.com/v1/models?endpoint=chat",
  ],
  [
    "huggingface",
    "openai-compatible",
    "https://router.huggingface.co/v1/chat/completions",
    "org/model",
    {
      data: [
        { id: "org/model", providers: [{ status: "live" }] },
        { id: "org/offline", providers: [{ status: "error" }] },
      ],
    },
    { choices: [{ message: { content: '{"ok":true}' } }] },
    "https://router.huggingface.co/v1/models",
  ],
])(
  "%s uses guarded discovery and chat",
  async (
    preset,
    protocol,
    endpoint,
    model,
    catalog,
    response,
    discoveryUrl,
  ) => {
    const config = validateProviderConfig({
      preset,
      protocol,
      endpoint,
      model,
      providerName: preset,
      authMode: "bearer",
      key: "example-key",
    });
    expect(() =>
      validateProviderConfig({
        ...config,
        endpoint: "https://evil.example/v1/chat",
      }),
    ).toThrow();
    vi.mocked(lookup).mockResolvedValue([
      { address: "8.8.8.8", family: 4 },
    ] as never);
    const calls: string[] = [];
    vi.mocked(request).mockImplementation(((
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
            ...(preset === "cohere" ? { temperature: 0 } : {}),
            max_tokens: 64,
            messages: [{ role: "user", content: "test" }],
          });
        const res = new EventEmitter() as IncomingMessage;
        res.statusCode = 200;
        callback(res);
        queueMicrotask(() => {
          res.emit(
            "data",
            Buffer.from(JSON.stringify(body ? response : catalog)),
          );
          res.emit("end");
        });
        return req;
      }) as ClientRequest["end"];
      return req;
    }) as typeof request);
    const signal = new AbortController().signal;
    expect(await discoverModels(config, signal)).toEqual({
      models: [model],
      truncated: false,
    });
    expect(
      await callProvider(
        config,
        [{ role: "user", content: "test" }],
        signal,
        "test",
      ),
    ).toEqual({ ok: true });
    expect(calls).toEqual([`GET ${discoveryUrl}`, `POST ${endpoint}`]);
    vi.mocked(lookup).mockResolvedValue([
      { address: "8.8.8.8", family: 4 },
      { address: "127.0.0.1", family: 4 },
    ] as never);
    vi.mocked(request).mockClear();
    await expect(callProvider(config, [], signal)).rejects.toThrow(
      "AI provider unavailable",
    );
    expect(request).not.toHaveBeenCalled();
  },
);
