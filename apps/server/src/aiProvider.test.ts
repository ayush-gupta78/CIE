import { createServer, type RequestListener } from "node:http";
import { EventEmitter, once } from "node:events";
import { lookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import type { ClientRequest, IncomingMessage, RequestOptions } from "node:http";

vi.mock("node:dns/promises", async (original) => ({
  ...(await original()),
  lookup: vi.fn(),
}));
vi.mock("node:https", async (original) => ({
  ...(await original()),
  request: vi.fn(),
}));
import { afterEach, expect, it, vi } from "vitest";
import { callProvider, validateProviderConfig } from "./aiProvider.js";

const local = {
  preset: "local",
  protocol: "openai-compatible",
  providerName: "Local",
  model: "test-model",
  authMode: "none",
} as const;
const custom = {
  preset: "custom",
  protocol: "openai-compatible",
  providerName: "Custom",
  model: "other-model",
  authMode: "bearer",
  key: "secret",
} as const;
const messages = [{ role: "user", content: "Return JSON" }];
const response = JSON.stringify({
  choices: [{ message: { content: '{"ok":true}' } }],
});

async function serve(handler: RequestListener) {
  const server = createServer(handler);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No address");
  return {
    endpoint: `http://127.0.0.1:${address.port}/v1/chat/completions`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

afterEach(() => vi.restoreAllMocks());

it("validates custom HTTPS and rejects unauthenticated remote providers", () => {
  expect(
    validateProviderConfig({
      ...custom,
      endpoint: "https://ai.example/v1/chat/completions",
    }),
  ).toMatchObject({ model: "other-model", providerName: "Custom" });
  expect(() =>
    validateProviderConfig({
      ...custom,
      authMode: "none",
      endpoint: "https://ai.example/",
    }),
  ).toThrow();
  expect(() =>
    validateProviderConfig({ ...local, endpoint: "https://ai.example/" }),
  ).toThrow();
});

it("pins custom HTTPS DNS resolution and sends bearer credentials in a header", async () => {
  vi.mocked(lookup).mockResolvedValue([
    { address: "8.8.8.8", family: 4 },
    { address: "2001:4860:4860::8888", family: 6 },
  ] as never);
  let sent = "";
  vi.mocked(httpsRequest).mockImplementation(((
    url: URL,
    options: RequestOptions,
    callback: (res: IncomingMessage) => void,
  ) => {
    expect(url.hostname).toBe("ai.example");
    expect((options.headers as Record<string, string>).authorization).toBe(
      "Bearer secret",
    );
    options.lookup!("ai.example", {}, (_error, address) =>
      expect(address).toBe("8.8.8.8"),
    );
    const req = new EventEmitter() as ClientRequest;
    req.setTimeout = vi.fn();
    req.destroy = vi.fn();
    req.end = ((body: string) => {
      sent = body;
      const res = new EventEmitter() as IncomingMessage;
      res.statusCode = 200;
      callback(res);
      queueMicrotask(() => {
        res.emit("data", Buffer.from(response));
        res.emit("end");
      });
    }) as ClientRequest["end"];
    return req;
  }) as typeof httpsRequest);
  expect(
    await callProvider(
      validateProviderConfig({
        ...custom,
        endpoint: "https://ai.example/v1/chat/completions",
      }),
      messages,
      new AbortController().signal,
    ),
  ).toEqual({ ok: true });
  expect(JSON.parse(sent).model).toBe("other-model");
  expect(lookup).toHaveBeenCalledTimes(1);
});

it("accepts a public IPv4 address outside the special-use subranges", async () => {
  vi.mocked(lookup).mockResolvedValue([
    { address: "192.0.20.1", family: 4 },
  ] as never);
  vi.mocked(httpsRequest).mockImplementation(((
    url: URL,
    options: RequestOptions,
    callback: (res: IncomingMessage) => void,
  ) => {
    expect(url.hostname).toBe("ai.example");
    options.lookup!("ai.example", {}, (_error, address) =>
      expect(address).toBe("192.0.20.1"),
    );
    const req = new EventEmitter() as ClientRequest;
    req.setTimeout = vi.fn();
    req.destroy = vi.fn();
    req.end = (() => {
      const res = new EventEmitter() as IncomingMessage;
      res.statusCode = 200;
      callback(res);
      queueMicrotask(() => {
        res.emit("data", Buffer.from(response));
        res.emit("end");
      });
      return req;
    }) as ClientRequest["end"];
    return req;
  }) as typeof httpsRequest);
  await expect(
    callProvider(
      validateProviderConfig({ ...custom, endpoint: "https://ai.example/v1" }),
      messages,
      new AbortController().signal,
    ),
  ).resolves.toEqual({ ok: true });
});

it("rejects a mixed DNS response containing a private address before connecting", async () => {
  vi.mocked(lookup).mockResolvedValue([
    { address: "8.8.8.8", family: 4 },
    { address: "169.254.169.254", family: 4 },
  ] as never);
  await expect(
    callProvider(
      validateProviderConfig({
        ...custom,
        endpoint: "https://ai.example/v1/chat/completions",
      }),
      messages,
      new AbortController().signal,
    ),
  ).rejects.toThrow("AI provider unavailable");
  expect(httpsRequest).not.toHaveBeenCalled();
});

it.each(["2001:0db8::1", "2001:2::1", "2002:c000:0201::1", "3fff::1"])(
  "rejects mixed DNS responses with special-use IPv6 answer %s",
  async (address) => {
    vi.mocked(lookup).mockResolvedValue([
      { address: "8.8.8.8", family: 4 },
      { address, family: 6 },
    ] as never);
    await expect(
      callProvider(
        validateProviderConfig({
          ...custom,
          endpoint: "https://ai.example/v1/chat/completions",
        }),
        messages,
        new AbortController().signal,
      ),
    ).rejects.toThrow("AI provider unavailable");
    expect(httpsRequest).not.toHaveBeenCalled();
  },
);

it.each([
  "0.2.3.4",
  "10.0.0.1",
  "100.64.0.1",
  "127.0.0.1",
  "169.254.169.254",
  "168.63.129.16",
  "172.16.1.1",
  "192.0.0.1",
  "192.0.2.1",
  "192.31.196.1",
  "192.52.193.1",
  "192.88.99.1",
  "192.168.1.1",
  "192.175.48.1",
  "198.18.0.1",
  "198.51.100.1",
  "203.0.113.1",
  "224.0.0.1",
  "240.0.0.1",
  "255.255.255.255",
])(
  "rejects special-use DNS destination %s before sending credentials",
  async (address) => {
    vi.mocked(lookup).mockResolvedValue([{ address, family: 4 }] as never);
    await expect(
      callProvider(
        validateProviderConfig({
          ...custom,
          endpoint: "https://ai.example/v1/chat/completions",
        }),
        messages,
        new AbortController().signal,
      ),
    ).rejects.toThrow("AI provider unavailable");
    expect(httpsRequest).not.toHaveBeenCalled();
  },
);

it("sends OpenAI-compatible JSON to local loopback without credentials", async () => {
  let body: Record<string, unknown> = {},
    authorization: string | undefined;
  const server = await serve(async (req, res) => {
    authorization = req.headers.authorization;
    let text = "";
    for await (const chunk of req) text += chunk;
    body = JSON.parse(text);
    res.end(response);
  });
  try {
    expect(
      await callProvider(
        validateProviderConfig({ ...local, endpoint: server.endpoint }),
        messages,
        new AbortController().signal,
      ),
    ).toEqual({ ok: true });
    expect(authorization).toBeUndefined();
    expect(body).toMatchObject({
      model: "test-model",
      temperature: 0,
      max_tokens: 450,
      messages,
    });
    expect(body.response_format).toBeUndefined();
  } finally {
    await server.close();
  }
});

it("sends one bounded request without automatic retries to a compatible local server", async () => {
  const bodies: Record<string, unknown>[] = [];
  const server = await serve(async (req, res) => {
    let text = "";
    for await (const chunk of req) text += chunk;
    bodies.push(JSON.parse(text));
    res.statusCode = 400;
    res.end('{"error":"response_format unsupported"}');
  });
  try {
    await expect(
      callProvider(
        validateProviderConfig({ ...local, endpoint: server.endpoint }),
        messages,
        new AbortController().signal,
      ),
    ).rejects.toThrow();
    expect(bodies).toHaveLength(1);
    expect(bodies[0].response_format).toBeUndefined();
  } finally {
    await server.close();
  }
});

it("rejects remote SSRF destinations and URL credential leaks", () => {
  for (const endpoint of [
    "https://127.0.0.1/x",
    "https://169.254.169.254/latest/meta-data",
    "https://10.0.0.1/x",
    "https://[::1]/x",
    "http://ai.example/x",
    "https://user:pass@ai.example/x",
    "https://ai.example/x#fragment",
    "https://localhost/x",
  ]) {
    expect(() => validateProviderConfig({ ...custom, endpoint })).toThrow();
  }
  expect(() =>
    validateProviderConfig({ ...local, endpoint: "http://169.254.169.254/x" }),
  ).toThrow();
  expect(() =>
    validateProviderConfig({
      ...custom,
      endpoint: "https://ai.example/v1?api_key=secret",
    }),
  ).toThrow();
  expect(() =>
    validateProviderConfig({
      ...custom,
      endpoint: "https://ai.example/\nrequest",
    }),
  ).toThrow();
});

it("does not follow redirects to private destinations", async () => {
  const server = await serve((_req, res) => {
    res.statusCode = 302;
    res.setHeader("location", "http://169.254.169.254/latest/meta-data");
    res.end();
  });
  try {
    await expect(
      callProvider(
        validateProviderConfig({ ...local, endpoint: server.endpoint }),
        messages,
        new AbortController().signal,
      ),
    ).rejects.toThrow("AI provider unavailable");
  } finally {
    await server.close();
  }
});

it.each([
  [401, "AI_AUTH"],
  [429, "AI_RATE_LIMIT"],
])("returns a safe provider state for HTTP %i", async (status, code) => {
  const server = await serve((_req, res) => {
    res.statusCode = status;
    res.end("credential text must not escape");
  });
  try {
    await expect(
      callProvider(
        validateProviderConfig({ ...local, endpoint: server.endpoint }),
        messages,
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code });
  } finally {
    await server.close();
  }
});

it("revalidates changed config at the transport boundary", async () => {
  const config = validateProviderConfig({
    ...local,
    endpoint: "http://127.0.0.1:1234/v1",
  });
  config.endpoint = "http://169.254.169.254/latest/meta-data";
  await expect(
    callProvider(config, messages, new AbortController().signal),
  ).rejects.toThrow("Invalid AI provider configuration");
});

it("cancels pending DNS resolution on the external signal", async () => {
  vi.mocked(lookup).mockImplementation(() => new Promise<never>(() => {}));
  const controller = new AbortController();
  const pending = callProvider(
    validateProviderConfig({ ...custom, endpoint: "https://ai.example/v1" }),
    messages,
    controller.signal,
  );
  controller.abort();
  await expect(pending).rejects.toThrow("AI provider unavailable");
});

it("bounds responses and respects external cancellation without leaking secrets", async () => {
  const server = await serve((_req, res) => res.end("x".repeat(17000)));
  try {
    await expect(
      callProvider(
        validateProviderConfig({ ...local, endpoint: server.endpoint }),
        messages,
        new AbortController().signal,
      ),
    ).rejects.toThrow("AI response too large");
    const controller = new AbortController();
    controller.abort();
    await expect(
      callProvider(
        validateProviderConfig({ ...local, endpoint: server.endpoint }),
        messages,
        controller.signal,
      ),
    ).rejects.toThrow();
  } finally {
    await server.close();
  }
});
