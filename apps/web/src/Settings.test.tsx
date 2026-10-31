import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Settings } from "./Settings";

const initial = {
  enabled: false,
  consent: true,
  providerName: "OpenAI",
  protocol: "openai-compatible",
  endpointUrl: "https://api.openai.com/v1/chat/completions",
  model: "gpt-4o-mini",
  authMode: "bearer",
  local: false,
  hasKey: true,
};
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it("requires renewed endpoint consent and saves a custom endpoint with a cleared key", async () => {
  const fetcher = vi.fn(async (_url: string, init?: RequestInit) => ({
    ok: true,
    json: async () =>
      init?.method === "PUT"
        ? { ...initial, ...JSON.parse(init.body as string), hasKey: false }
        : initial,
  }));
  vi.stubGlobal("fetch", fetcher);
  const user = userEvent.setup();
  render(
    <Settings
      version="1"
      statusText="Connected"
      connection="connected"
      check={() => {}}
    />,
  );
  await screen.findByRole("combobox", { name: /Provider preset/ });
  await waitFor(() =>
    expect(
      screen.getByRole<HTMLInputElement>("checkbox", { name: /consent/i })
        .checked,
    ).toBe(true),
  );
  await user.selectOptions(
    screen.getByRole("combobox", { name: /Provider preset/ }),
    "custom",
  );
  await user.type(
    screen.getByRole("textbox", { name: /Provider name/ }),
    "Example",
  );
  await user.type(
    screen.getByRole("textbox", { name: /Endpoint URL/ }),
    "https://example.com/v1/chat/completions",
  );
  await user.type(
    screen.getByRole("textbox", { name: /Model/ }),
    "other-model",
  );
  expect(
    screen.getByRole<HTMLInputElement>("checkbox", { name: /consent/i })
      .checked,
  ).toBe(false);
  await user.click(screen.getByText("Manage saved settings"));
  await user.click(screen.getByText("Save or disable without connecting"));
  await user.click(screen.getByRole("checkbox", { name: /Clear saved key/ }));
  await user.click(screen.getByRole("checkbox", { name: /consent/i }));
  await user.click(
    screen.getByRole("button", { name: "Save assistant settings" }),
  );
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(3));
  expect(JSON.parse(fetcher.mock.calls[2]![1]!.body as string)).toMatchObject({
    providerName: "Example",
    endpointUrl: "https://example.com/v1/chat/completions",
    model: "other-model",
    local: false,
    authMode: "bearer",
    consent: true,
    apiKey: null,
  });
  expect(screen.getAllByText(/example.com/).length).toBeGreaterThan(0);
});
it("allows a local endpoint without bearer credentials and discloses locality", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, json: async () => initial })),
  );
  const user = userEvent.setup();
  render(
    <Settings
      version="1"
      statusText="Connected"
      connection="connected"
      check={() => {}}
    />,
  );
  await screen.findByRole("combobox", { name: /Provider preset/ });
  await user.selectOptions(
    screen.getByRole("combobox", { name: /Provider preset/ }),
    "local",
  );
  await user.selectOptions(
    screen.getByRole("combobox", { name: /Authentication/ }),
    "none",
  );
  expect(screen.getAllByText(/local endpoint/i).length).toBeGreaterThan(0);
  await user.click(screen.getByText("Save or disable without connecting"));
  expect(
    screen.getByRole("button", { name: "Save assistant settings" }),
  ).toBeTruthy();
  await user.clear(screen.getByRole("textbox", { name: /Endpoint URL/ }));
  await user.type(
    screen.getByRole("textbox", { name: /Endpoint URL/ }),
    "https://remote.example/v1/chat/completions",
  );
  expect(screen.getByText(/External endpoint: remote.example/)).toBeTruthy();
  expect(
    screen.getByRole<HTMLButtonElement>("button", {
      name: "Save assistant settings",
    }).disabled,
  ).toBe(true);
});

it("connects only after consent and tests the saved provider", async () => {
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => ({
    ok: true,
    json: async () =>
      url.endsWith("/models")
        ? { models: ["gpt-4o-mini"], truncated: false }
        : url.endsWith("/test")
          ? { ok: true }
          : init?.method === "PUT"
            ? { ...initial, ...JSON.parse(init.body as string), hasKey: true }
            : { ...initial, enabled: false, consent: false, hasKey: false },
  }));
  vi.stubGlobal("fetch", fetcher);
  const user = userEvent.setup();
  render(
    <Settings
      version="1"
      statusText="Connected"
      connection="connected"
      check={() => {}}
    />,
  );
  const connect = await screen.findByRole<HTMLButtonElement>("button", {
    name: "Connect assistant",
  });
  expect(connect.disabled).toBe(true);
  await user.type(screen.getByLabelText(/API key/), "example-key");
  await user.click(screen.getByRole("checkbox", { name: /consent/i }));
  await user.click(connect);
  await screen.findByText(/connection succeeded/i);
  expect(screen.getByText("Connection: verified")).toBeTruthy();
  expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
    "/api/v1/ai/providers",
    "/api/v1/ai/config",
    "/api/v1/ai/config",
    "/api/v1/ai/models",
    "/api/v1/ai/test",
  ]);
});

it("does not claim a connection for an invalid test response", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => ({
      ok: true,
      json: async () =>
        url.endsWith("/models")
          ? { models: ["gpt-4o-mini"], truncated: false }
          : url.endsWith("/test")
            ? {}
            : init?.method === "PUT"
              ? { ...initial, enabled: true, consent: true }
              : initial,
    })),
  );
  const user = userEvent.setup();
  render(
    <Settings
      version="1"
      statusText="Connected"
      connection="connected"
      check={() => {}}
    />,
  );
  await waitFor(() =>
    expect(
      screen.getByRole<HTMLInputElement>("checkbox", { name: /consent/i })
        .checked,
    ).toBe(true),
  );
  await user.click(screen.getByRole("button", { name: "Connect assistant" }));
  await screen.findByText(/invalid assistant data/i);
  expect(screen.queryByText(/connection succeeded/i)).toBeNull();
});

it("discovers and verifies a native provider after explicit consent", async () => {
  let current: Record<string, unknown> = { ...initial, consent: false };
  const native = {
    preset: "gemini",
    protocol: "gemini",
    providerName: "Gemini",
    endpointUrl: "https://generativelanguage.googleapis.com/v1beta/models",
    model: "gemini-2.5-flash",
    authMode: "bearer",
    local: false,
  };
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => ({
    ok: true,
    json: async () => {
      if (url.endsWith("/providers")) return { providers: [native] };
      if (url.endsWith("/models"))
        return { models: ["gemini-2.5-pro"], truncated: false };
      if (url.endsWith("/test")) return { ok: true };
      if (init?.method === "PUT") {
        current = {
          ...current,
          ...JSON.parse(init.body as string),
          hasKey: true,
        };
      }
      return current;
    },
  }));
  vi.stubGlobal("fetch", fetcher);
  const user = userEvent.setup();
  render(
    <Settings
      version="1"
      statusText="Connected"
      connection="connected"
      check={() => {}}
    />,
  );
  await screen.findByRole("option", { name: "Gemini" });
  await user.selectOptions(
    screen.getByRole("combobox", { name: /Provider preset/ }),
    "gemini",
  );
  await user.type(screen.getByLabelText(/API key/), "test-key");
  await user.click(screen.getByRole("checkbox", { name: /consent/i }));
  await user.click(screen.getByRole("button", { name: "Connect assistant" }));
  await screen.findByText(/model manually/i);
  expect(
    screen.getByRole<HTMLButtonElement>("button", {
      name: "Test provider connection",
    }).disabled,
  ).toBe(true);
  expect(screen.getByText(/Discovered models: gemini-2.5-pro/)).toBeTruthy();
  expect(current.model).not.toBe("gemini-2.5-pro");
  expect(fetcher.mock.calls.some(([url]) => url.endsWith("/test"))).toBe(false);
  await user.click(screen.getByText("Advanced settings"));
  const model = screen.getByRole("textbox", { name: /Model/ });
  await user.clear(model);
  await user.type(model, "unknown-model");
  await user.click(screen.getByRole("button", { name: "Connect assistant" }));
  await screen.findByText(/model manually/i);
  expect(fetcher.mock.calls.some(([url]) => url.endsWith("/test"))).toBe(false);
  await user.clear(model);
  await user.type(model, "gemini-2.5-pro");
  await user.click(screen.getByRole("button", { name: "Connect assistant" }));
  await screen.findByText(/connection succeeded/i);
  expect(current.model).toBe("gemini-2.5-pro");
  expect(fetcher.mock.calls.at(-1)?.[0]).toBe("/api/v1/ai/test");
});

it("does not claim success when native discovery fails", async () => {
  let current: Record<string, unknown> = { ...initial, consent: false };
  const native = {
    preset: "anthropic",
    protocol: "anthropic",
    providerName: "Anthropic",
    endpointUrl: "https://api.anthropic.com/v1/messages",
    model: "claude-sonnet-4-5",
    authMode: "bearer",
    local: false,
  };
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => ({
    ok: true,
    json: async () => {
      if (url.endsWith("/providers")) return { providers: [native] };
      if (url.endsWith("/models")) return { models: [], truncated: false };
      if (init?.method === "PUT")
        current = {
          ...current,
          ...JSON.parse(init.body as string),
          hasKey: true,
        };
      return current;
    },
  }));
  vi.stubGlobal("fetch", fetcher);
  const user = userEvent.setup();
  render(
    <Settings
      version="1"
      statusText="Connected"
      connection="connected"
      check={() => {}}
    />,
  );
  await screen.findByRole("option", { name: "Anthropic" });
  await user.selectOptions(
    screen.getByRole("combobox", { name: /Provider preset/ }),
    "anthropic",
  );
  await user.type(screen.getByLabelText(/API key/), "test-key");
  await user.click(screen.getByRole("checkbox", { name: /consent/i }));
  await user.click(screen.getByRole("button", { name: "Connect assistant" }));
  await screen.findByText(/No supported model was found/i);
  expect(fetcher.mock.calls.some(([url]) => url.endsWith("/test"))).toBe(false);
});

it.each([
  ["sambanova", "SambaNova", "https://api.sambanova.ai/v1/chat/completions"],
  ["novita", "Novita", "https://api.novita.ai/openai/v1/chat/completions"],
  ["cohere", "Cohere", "https://api.cohere.com/v2/chat"],
  [
    "huggingface",
    "Hugging Face",
    "https://router.huggingface.co/v1/chat/completions",
  ],
  [
    "fireworks",
    "Fireworks AI",
    "https://api.fireworks.ai/inference/v1/chat/completions",
  ],
  ["xai", "xAI", "https://api.x.ai/v1/chat/completions"],
  ["openrouter", "OpenRouter", "https://openrouter.ai/api/v1/chat/completions"],
  [
    "nvidia",
    "NVIDIA NIM",
    "https://integrate.api.nvidia.com/v1/chat/completions",
  ],
  ["groq", "Groq", "https://api.groq.com/openai/v1/chat/completions"],
  ["deepseek", "DeepSeek", "https://api.deepseek.com/chat/completions"],
  ["mistral", "Mistral", "https://api.mistral.ai/v1/chat/completions"],
  ["cerebras", "Cerebras", "https://api.cerebras.ai/v1/chat/completions"],
  ["together", "Together AI", "https://api.together.ai/v1/chat/completions"],
])(
  "requires discovered manual model for %s and rejects forged registry endpoints",
  async (preset, name, endpointUrl) => {
    let current: Record<string, unknown> = { ...initial, consent: false };
    const provider = {
      preset,
      providerName: name,
      endpointUrl,
      model:
        preset === "cohere" ||
        preset === "huggingface" ||
        preset === "sambanova" ||
        preset === "novita"
          ? ""
          : "registry-default",
      protocol: preset === "cohere" ? "cohere" : "openai-compatible",
      authMode: "bearer",
      local: false,
    };
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => ({
      ok: true,
      json: async () => {
        if (url.endsWith("/providers"))
          return {
            providers: [
              provider,
              {
                ...provider,
                endpointUrl: "https://attacker.example/v1/chat/completions",
                providerName: "Forged",
              },
            ],
          };
        if (url.endsWith("/models"))
          return {
            models: ["expensive-model", "chosen-model"],
            truncated: false,
          };
        if (url.endsWith("/test")) return { ok: true };
        if (init?.method === "PUT")
          current = {
            ...current,
            ...JSON.parse(init.body as string),
            hasKey: true,
          };
        return current;
      },
    }));
    vi.stubGlobal("fetch", fetcher);
    const user = userEvent.setup();
    render(
      <Settings
        version="1"
        statusText="Connected"
        connection="connected"
        check={() => {}}
      />,
    );
    await screen.findByRole("option", { name });
    expect(screen.queryByRole("option", { name: "Forged" })).toBeNull();
    await user.selectOptions(
      screen.getByRole("combobox", { name: /Provider preset/ }),
      preset,
    );
    await user.type(screen.getByLabelText(/API key/), "test-key");
    await user.click(screen.getByRole("checkbox", { name: /consent/i }));
    await user.click(screen.getByRole("button", { name: "Connect assistant" }));
    await screen.findByText(/model manually/i);
    expect(fetcher.mock.calls.some(([url]) => url.endsWith("/test"))).toBe(
      false,
    );
    expect(screen.getByText(/pricing.*unknown/i)).toBeTruthy();
    await user.click(screen.getByText("Advanced settings"));
    const model = screen.getByRole("textbox", { name: /Model/ });
    await user.clear(model);
    await user.type(model, "chosen-model");
    await user.click(screen.getByRole("button", { name: "Connect assistant" }));
    await screen.findByText(/connection succeeded/i);
    expect(current).toMatchObject({
      preset,
      endpointUrl,
      model: "chosen-model",
      protocol: preset === "cohere" ? "cohere" : "openai-compatible",
    });
    const writes = fetcher.mock.calls
      .filter(([, init]) => init?.method === "PUT")
      .map(([, init]) => JSON.parse(init!.body as string));
    expect(writes[0]).toMatchObject({
      preset,
      endpointUrl,
      enabled: false,
      consent: false,
    });
    expect(writes[0]).not.toHaveProperty("apiKey");
    expect(writes.filter((write) => write.apiKey)).toEqual([
      expect.objectContaining({ preset, endpointUrl, apiKey: "test-key" }),
    ]);
    expect(
      fetcher.mock.calls.filter(([url]) => url.endsWith("/test")),
    ).toHaveLength(1);
  },
);

it("discovers OpenAI before testing and never silently chooses another model", async () => {
  let current: Record<string, unknown> = { ...initial };
  let models = ["expensive-model"];
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => ({
    ok: true,
    json: async () => {
      if (url.endsWith("/providers")) return { providers: [] };
      if (url.endsWith("/models")) return { models, truncated: false };
      if (url.endsWith("/test")) return { ok: true };
      if (init?.method === "PUT")
        current = { ...current, ...JSON.parse(init.body as string) };
      return current;
    },
  }));
  vi.stubGlobal("fetch", fetcher);
  const user = userEvent.setup();
  render(
    <Settings
      version="1"
      statusText="Connected"
      connection="connected"
      check={() => {}}
    />,
  );
  await waitFor(() =>
    expect(
      screen.getByRole<HTMLInputElement>("checkbox", { name: /consent/i })
        .checked,
    ).toBe(true),
  );
  await user.click(screen.getByRole("button", { name: "Connect assistant" }));
  await screen.findByText(/model manually/i);
  expect(
    fetcher.mock.calls.filter(([url]) => url.endsWith("/test")),
  ).toHaveLength(0);
  models = ["expensive-model", "gpt-4o-mini"];
  await user.click(screen.getByRole("button", { name: "Connect assistant" }));
  await screen.findByText("Connection: verified");
  expect(
    fetcher.mock.calls.filter(([url]) => url.endsWith("/test")),
  ).toHaveLength(1);
  expect(current.model).toBe("gpt-4o-mini");
});

it.each([
  ["local", "http://127.0.0.1:11434/v1/chat/completions", true],
  ["local", "http://127.0.0.1:11434/other", false],
  ["custom", "https://example.com/v1/chat/completions", true],
])(
  "requires an explicit %s model choice for %s",
  async (preset, endpoint, supportsDiscovery) => {
    let current: Record<string, unknown> = { ...initial, consent: false };
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => ({
      ok: true,
      json: async () => {
        if (url.endsWith("/providers")) return { providers: [] };
        if (url.endsWith("/models"))
          return { models: ["chosen", "expensive"], truncated: false };
        if (url.endsWith("/test")) return { ok: true };
        if (init?.method === "PUT")
          current = {
            ...current,
            ...JSON.parse(init.body as string),
            hasKey: true,
          };
        return current;
      },
    }));
    vi.stubGlobal("fetch", fetcher);
    const user = userEvent.setup();
    render(
      <Settings
        version="1"
        statusText="Connected"
        connection="connected"
        check={() => {}}
      />,
    );
    await waitFor(() =>
      expect(
        screen.getByRole<HTMLInputElement>("checkbox", { name: /consent/i })
          .checked,
      ).toBe(false),
    );
    await user.selectOptions(
      screen.getByRole("combobox", { name: /Provider preset/ }),
      preset,
    );
    const name = screen.getByRole("textbox", { name: /Provider name/ });
    if (preset === "custom") await user.type(name, "Example");
    const url = screen.getByRole("textbox", { name: /Endpoint URL/ });
    await user.clear(url);
    await user.type(url, endpoint);
    const model = screen.getByRole("textbox", { name: /Model/ });
    if (preset === "custom") await user.type(model, "placeholder");
    if (preset === "custom")
      await user.type(screen.getByLabelText(/API key/), "test-key");
    await user.click(screen.getByRole("checkbox", { name: /consent/i }));
    await user.click(screen.getByRole("button", { name: "Connect assistant" }));
    await screen.findByText(/model manually/i);
    expect(
      fetcher.mock.calls.filter(([url]) => url.endsWith("/models")),
    ).toHaveLength(supportsDiscovery ? 1 : 0);
    expect(
      fetcher.mock.calls.filter(([url]) => url.endsWith("/test")),
    ).toHaveLength(0);
    await user.clear(model);
    await user.type(model, "chosen");
    await user.click(screen.getByRole("button", { name: "Connect assistant" }));
    await screen.findByText("Connection: verified");
    expect(current.model).toBe("chosen");
    expect(
      fetcher.mock.calls.filter(([url]) => url.endsWith("/test")),
    ).toHaveLength(1);
  },
);

it("requires a deliberate manual OpenAI retry when discovery is unavailable", async () => {
  let current: Record<string, unknown> = { ...initial };
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => ({
    ok: !url.endsWith("/models"),
    json: async () => {
      if (url.endsWith("/providers")) return { providers: [] };
      if (url.endsWith("/models")) return { error: "unavailable" };
      if (url.endsWith("/test")) return { ok: true };
      if (init?.method === "PUT")
        current = { ...current, ...JSON.parse(init.body as string) };
      return current;
    },
  }));
  vi.stubGlobal("fetch", fetcher);
  const user = userEvent.setup();
  render(
    <Settings
      version="1"
      statusText="Connected"
      connection="connected"
      check={() => {}}
    />,
  );
  await waitFor(() =>
    expect(
      screen.getByRole<HTMLInputElement>("checkbox", { name: /consent/i })
        .checked,
    ).toBe(true),
  );
  await user.click(screen.getByRole("button", { name: "Connect assistant" }));
  await screen.findByText(/discovery unavailable/i);
  expect(
    fetcher.mock.calls.filter(([url]) => url.endsWith("/test")),
  ).toHaveLength(0);
  await user.click(screen.getByText("Advanced settings"));
  const model = screen.getByRole("textbox", { name: /Model/ });
  await user.clear(model);
  await user.type(model, "chosen-model");
  await user.click(screen.getByRole("button", { name: "Connect assistant" }));
  await screen.findByText("Connection: verified");
  expect(current.model).toBe("chosen-model");
  expect(
    fetcher.mock.calls.filter(([url]) => url.endsWith("/test")),
  ).toHaveLength(1);
});

it.each(["custom", "local"])(
  "permits a deliberate %s override after discovery fails without retrying discovery",
  async (preset) => {
    let current: Record<string, unknown> = { ...initial, consent: false };
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => ({
      ok: !url.endsWith("/models"),
      json: async () => {
        if (url.endsWith("/providers")) return { providers: [] };
        if (url.endsWith("/models")) return { error: "unavailable" };
        if (url.endsWith("/test")) return { ok: true };
        if (init?.method === "PUT")
          current = {
            ...current,
            ...JSON.parse(init.body as string),
            hasKey: preset === "custom",
          };
        return current;
      },
    }));
    vi.stubGlobal("fetch", fetcher);
    const user = userEvent.setup();
    render(
      <Settings
        version="1"
        statusText="Connected"
        connection="connected"
        check={() => {}}
      />,
    );
    await screen.findByRole("combobox", { name: /Provider preset/ });
    await user.selectOptions(
      screen.getByRole("combobox", { name: /Provider preset/ }),
      preset,
    );
    const model = screen.getByRole("textbox", { name: /Model/ });
    if (preset === "custom") {
      await user.type(
        screen.getByRole("textbox", { name: /Provider name/ }),
        "Example",
      );
      await user.type(
        screen.getByRole("textbox", { name: /Endpoint URL/ }),
        "https://example.com/v1/chat/completions",
      );
      await user.type(model, "initial-model");
      await user.type(screen.getByLabelText(/API key/), "secret-credential");
    }
    await user.click(screen.getByRole("checkbox", { name: /consent/i }));
    await user.click(screen.getByRole("button", { name: "Connect assistant" }));
    await screen.findByText(/discovery unavailable/i);
    expect(
      fetcher.mock.calls.filter(([url]) => url.endsWith("/test")),
    ).toHaveLength(0);
    await user.clear(model);
    await user.type(model, "chosen-model");
    await user.click(screen.getByRole("button", { name: "Connect assistant" }));
    await screen.findByText("Connection: verified");
    expect(current.model).toBe("chosen-model");
    expect(
      fetcher.mock.calls.filter(([url]) => url.endsWith("/models")),
    ).toHaveLength(1);
    expect(
      fetcher.mock.calls.filter(([url]) => url.endsWith("/test")),
    ).toHaveLength(1);
    expect(document.body.textContent).not.toContain("secret-credential");
    for (const [, init] of fetcher.mock.calls.filter(
      ([url]) => url.endsWith("/models") || url.endsWith("/test"),
    )) {
      expect(init?.body).not.toContain("secret-credential");
    }
  },
);

it("invalidates verified status when returning to the tab", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => ({
      ok: true,
      json: async () =>
        url.endsWith("/models")
          ? { models: ["gpt-4o-mini"], truncated: false }
          : url.endsWith("/test")
            ? { ok: true }
            : init?.method === "PUT"
              ? { ...initial, enabled: true }
              : initial,
    })),
  );
  const user = userEvent.setup();
  render(
    <Settings
      version="1"
      statusText="Connected"
      connection="connected"
      check={() => {}}
    />,
  );
  await waitFor(() =>
    expect(
      screen.getByRole<HTMLInputElement>("checkbox", { name: /consent/i })
        .checked,
    ).toBe(true),
  );
  await user.click(screen.getByRole("button", { name: "Connect assistant" }));
  await screen.findByText("Connection: verified");
  window.dispatchEvent(new Event("focus"));
  await waitFor(() =>
    expect(screen.queryByText("Connection: verified")).toBeNull(),
  );
});

it("connects a discovered hosted default without trying other models", async () => {
  let current: Record<string, unknown> = { ...initial, consent: false };
  const provider = {
    preset: "groq",
    protocol: "openai-compatible",
    providerName: "Groq",
    endpointUrl: "https://api.groq.com/openai/v1/chat/completions",
    model: "llama-3.3-70b-versatile",
    authMode: "bearer",
    local: false,
  };
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => ({
    ok: true,
    json: async () => {
      if (url.endsWith("/providers")) return { providers: [provider] };
      if (url.endsWith("/models"))
        return { models: [provider.model, "expensive"], truncated: false };
      if (url.endsWith("/test")) return { ok: true };
      if (init?.method === "PUT")
        current = {
          ...current,
          ...JSON.parse(init.body as string),
          hasKey: true,
        };
      return current;
    },
  }));
  vi.stubGlobal("fetch", fetcher);
  const user = userEvent.setup();
  render(
    <Settings
      version="1"
      statusText="Connected"
      connection="connected"
      check={() => {}}
    />,
  );
  await screen.findByRole("option", { name: "Groq" });
  await user.selectOptions(
    screen.getByRole("combobox", { name: /Provider preset/ }),
    "groq",
  );
  await user.type(screen.getByLabelText(/API key/), "test-key");
  await user.click(screen.getByRole("checkbox", { name: /consent/i }));
  await user.click(screen.getByRole("button", { name: "Connect assistant" }));
  await screen.findByText("Connection: verified");
  expect(current.model).toBe(provider.model);
  expect(
    fetcher.mock.calls.filter(([url]) => url.endsWith("/test")),
  ).toHaveLength(1);
});

it("blocks stale drafts after settings change in another tab", async () => {
  let current = { ...initial };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => ({
      ok: true,
      json: async () =>
        url.endsWith("/providers") ? { providers: [] } : current,
    })),
  );
  render(
    <Settings
      version="1"
      statusText="Connected"
      connection="connected"
      check={() => {}}
    />,
  );
  await waitFor(() =>
    expect(
      screen.getByRole<HTMLInputElement>("checkbox", { name: /consent/i })
        .checked,
    ).toBe(true),
  );
  current = { ...current, model: "new-model" };
  window.dispatchEvent(new Event("focus"));
  await screen.findByText(/settings changed.*reload/i);
  expect(
    screen.getByRole<HTMLButtonElement>("button", { name: "Connect assistant" })
      .disabled,
  ).toBe(true);
});

it("does not automatically test the xAI default", async () => {
  let current: Record<string, unknown> = { ...initial, consent: false };
  const provider = {
    preset: "xai",
    protocol: "openai-compatible",
    providerName: "xAI",
    endpointUrl: "https://api.x.ai/v1/chat/completions",
    model: "grok-4.7",
    authMode: "bearer",
    local: false,
  };
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => ({
    ok: true,
    json: async () => {
      if (url.endsWith("/providers")) return { providers: [provider] };
      if (url.endsWith("/models"))
        return { models: [provider.model], truncated: false };
      if (url.endsWith("/test")) return { ok: true };
      if (init?.method === "PUT")
        current = {
          ...current,
          ...JSON.parse(init.body as string),
          hasKey: true,
        };
      return current;
    },
  }));
  vi.stubGlobal("fetch", fetcher);
  const user = userEvent.setup();
  render(
    <Settings
      version="1"
      statusText="Connected"
      connection="connected"
      check={() => {}}
    />,
  );
  await screen.findByRole("option", { name: "xAI" });
  await user.selectOptions(
    screen.getByRole("combobox", { name: /Provider preset/ }),
    "xai",
  );
  await user.type(screen.getByLabelText(/API key/), "test-key");
  await user.click(screen.getByRole("checkbox", { name: /consent/i }));
  await user.click(screen.getByRole("button", { name: "Connect assistant" }));
  await screen.findByText(/model manually/i);
  expect(
    fetcher.mock.calls.filter(([url]) => url.endsWith("/test")),
  ).toHaveLength(0);
});
