// @vitest-environment node
import { EventEmitter } from "node:events";
import { lookup } from "node:dns/promises";
import type { ClientRequest, IncomingMessage, RequestOptions } from "node:http";
import { request } from "node:https";
import { request as httpRequest } from "node:http";
import { expect, it, vi } from "vitest";
import { createApp } from "../../server/src/app.js";

vi.mock("node:dns/promises", async (original) => ({
  ...(await original()),
  lookup: vi.fn(),
}));
vi.mock("node:http", async (original) => ({
  ...(await original()),
  request: vi.fn(),
}));
vi.mock("node:https", async (original) => ({
  ...(await original()),
  request: vi.fn(),
}));

it.each([
  ["cohere", "cohere", "https://api.cohere.com/v2/chat", "command-a"],
  [
    "huggingface",
    "openai-compatible",
    "https://router.huggingface.co/v1/chat/completions",
    "org/model",
  ],
])(
  "routes %s discovery and explicit connectivity through pinned transport",
  async (preset, protocol, endpointUrl, model) => {
    const app = createApp();
    const headers = { host: "127.0.0.1:3001", origin: "http://127.0.0.1:5173" };
    const send = (method: string, url: string, payload?: object) =>
      app.inject({ method, url, headers, payload });
    const calls: string[] = [];
    vi.mocked(lookup).mockResolvedValue([
      { address: "8.8.8.8", family: 4 },
    ] as never);
    vi.mocked(request).mockImplementation(((
      url: URL,
      options: RequestOptions,
      callback: (res: IncomingMessage) => void,
    ) => {
      calls.push(`${options.method} ${url.href}`);
      options.lookup!(url.hostname, {}, (_error, address) =>
        expect(address).toBe("8.8.8.8"),
      );
      expect((options.headers as Record<string, string>).authorization).toBe(
        "Bearer fixture-key",
      );
      const req = new EventEmitter() as ClientRequest;
      req.setTimeout = vi.fn();
      req.destroy = vi.fn();
      req.end = ((body?: string) => {
        if (body) expect(JSON.parse(body).model).toBe(model);
        const result = body
          ? preset === "cohere"
            ? {
                message: { content: [{ type: "text", text: '{"ok":true}' }] },
                finish_reason: "COMPLETE",
              }
            : { choices: [{ message: { content: '{"ok":true}' } }] }
          : preset === "cohere"
            ? { models: [{ name: model, endpoints: ["chat"] }] }
            : { data: [{ id: model, providers: [{ status: "live" }] }] };
        const res = new EventEmitter() as IncomingMessage;
        res.statusCode = 200;
        callback(res);
        queueMicrotask(() => {
          res.emit("data", Buffer.from(JSON.stringify(result)));
          res.emit("end");
        });
        return req;
      }) as ClientRequest["end"];
      return req;
    }) as typeof request);
    try {
      const providers = (await send("GET", "/api/v1/ai/providers")).json()
        .providers;
      expect(
        providers.find((p: { preset: string }) => p.preset === preset),
      ).toMatchObject({ endpointUrl, protocol, model: "" });
      const settings = {
        enabled: true,
        consent: true,
        preset,
        protocol,
        endpointUrl,
        model,
        providerName: preset,
        authMode: "bearer",
        local: false,
        apiKey: "fixture-key",
      };
      expect(
        (
          await send("PUT", "/api/v1/ai/config", {
            ...settings,
            endpointUrl: "https://evil.example/v1/chat",
          })
        ).statusCode,
      ).toBe(400);
      expect(
        (await send("PUT", "/api/v1/ai/config", settings)).json(),
      ).toMatchObject({ consent: false, hasKey: false });
      expect((await send("POST", "/api/v1/ai/models", {})).statusCode).not.toBe(
        200,
      );
      expect(
        (await send("PUT", "/api/v1/ai/config", settings)).json(),
      ).toMatchObject({ consent: true, hasKey: true });
      expect((await send("POST", "/api/v1/ai/models", {})).json()).toEqual({
        models: [model],
        truncated: false,
      });
      expect((await send("POST", "/api/v1/ai/test", {})).json()).toEqual({
        ok: true,
      });
      expect(calls).toHaveLength(2);
      expect(calls[0]).toContain("/v1/models");
      expect(calls[1]).toBe(`POST ${endpointUrl}`);
      expect(
        (await send("GET", "/api/v1/ai/config")).json().connectionStatus,
      ).toBe("verified");
    } finally {
      await app.close();
      vi.resetAllMocks();
    }
  },
);

it("discovers a local loopback catalog without bearer credentials", async () => {
  const app = createApp();
  const headers = { host: "127.0.0.1:3001", origin: "http://127.0.0.1:5173" };
  const send = (method: string, url: string, payload?: object) =>
    app.inject({ method, url, headers, payload });
  const http = await vi.importActual<typeof import("node:http")>("node:http");
  vi.mocked(httpRequest).mockImplementation(http.request);
  const received: { url?: string; authorization?: string }[] = [];
  const fixture = http.createServer((req, res) => {
    received.push({ url: req.url, authorization: req.headers.authorization });
    res.end(JSON.stringify({ data: [{ id: "local-model" }] }));
  });
  await new Promise<void>((resolve) => fixture.listen(0, "127.0.0.1", resolve));
  const address = fixture.address();
  if (!address || typeof address === "string")
    throw new Error("No fixture port");
  try {
    const settings = {
      enabled: true,
      consent: true,
      preset: "local",
      protocol: "openai-compatible",
      endpointUrl: `http://127.0.0.1:${address.port}/v1/chat/completions`,
      model: "local-model",
      providerName: "Local",
      authMode: "none",
      local: true,
    };
    await send("PUT", "/api/v1/ai/config", settings);
    expect(
      (await send("PUT", "/api/v1/ai/config", settings)).json(),
    ).toMatchObject({ consent: true, hasKey: false });
    expect((await send("POST", "/api/v1/ai/models", {})).json()).toEqual({
      models: ["local-model"],
      truncated: false,
    });
    expect(received).toEqual([{ url: "/v1/models", authorization: undefined }]);
  } finally {
    await new Promise<void>((resolve, reject) =>
      fixture.close((error) => (error ? reject(error) : resolve())),
    );
    await app.close();
    vi.resetAllMocks();
  }
});
