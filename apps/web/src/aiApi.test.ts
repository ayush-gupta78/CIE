import { afterEach, expect, it, vi } from "vitest";
import { askAi, getAiConfig, putAiConfig, verifiedCitation } from "./aiApi";
import type { Graph } from "./graphApi";

const graph = {
  repositoryId: "r",
  revision: 1,
  manifest: "m",
  files: [{ id: "a", path: "src/a.ts" }],
  edges: [
    {
      id: "e",
      from: "a",
      to: "b",
      resolution: "resolved_static",
      evidence: { path: "src/a.ts", line: 4 },
    },
  ],
} as Graph;
afterEach(() => vi.unstubAllGlobals());
it("validates response identity, config and graph citation provenance", async () => {
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    expect(url).toMatch(/^\/api\/v1\/ai\/config$/);
    expect(init?.method === undefined || init.method === "PUT").toBe(true);
    return {
      ok: true,
      json: async () => ({
        enabled: false,
        providerName: "OpenAI",
        protocol: "openai-compatible",
        endpointUrl: "https://api.openai.com/v1/chat/completions",
        model: "gpt-4o-mini",
        authMode: "bearer",
        local: false,
        hasKey: false,
        consent: false,
      }),
    };
  });
  vi.stubGlobal("fetch", fetcher);
  expect((await getAiConfig()).enabled).toBe(false);
  await putAiConfig({
    enabled: false,
    providerName: "OpenAI",
    protocol: "openai-compatible",
    endpointUrl: "https://api.openai.com/v1/chat/completions",
    model: "gpt-4o-mini",
    authMode: "bearer",
    local: false,
    consent: false,
  });
  expect(JSON.parse(fetcher.mock.calls[1]![1]!.body as string)).toEqual({
    enabled: false,
    providerName: "OpenAI",
    protocol: "openai-compatible",
    endpointUrl: "https://api.openai.com/v1/chat/completions",
    model: "gpt-4o-mini",
    authMode: "bearer",
    local: false,
    consent: false,
  });
  const citation = {
    fileId: "a",
    path: "src/a.ts",
    startLine: 4,
    category: "dependency",
    edgeId: "e",
    freshness: "verified",
  };
  expect(verifiedCitation(graph, citation)).toBe(true);
  expect(verifiedCitation(graph, { ...citation, startLine: 5 })).toBe(false);
  expect(
    verifiedCitation(graph, { ...citation, freshness: "unverified" }),
  ).toBe(false);
  expect(verifiedCitation(graph, { ...citation, path: "other/a.ts" })).toBe(
    false,
  );
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      json: async () => ({
        status: "cited",
        answer: "x",
        citations: [citation],
        limitations: [],
        warnings: [],
        repositoryId: "r",
        revision: 1,
        manifest: "old",
        provider: "openai",
        model: "gpt-4o-mini",
      }),
    })),
  );
  await expect(askAi(graph, "why?")).rejects.toMatchObject({
    code: "INVALID_RESPONSE",
  });
});
it("accepts a local keyless endpoint and rejects malformed runtime config and answer", async () => {
  const config = {
    enabled: true,
    consent: true,
    providerName: "Ollama",
    protocol: "openai-compatible",
    endpointUrl: "http://127.0.0.1:11434/v1/chat/completions",
    model: "llama3",
    authMode: "none",
    local: true,
    hasKey: false,
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, json: async () => config })),
  );
  expect(await getAiConfig()).toEqual(config);
  const answer = {
    status: "insufficient",
    answer: "",
    citations: [],
    limitations: [],
    warnings: ["Question redacted"],
    repositoryId: "r",
    revision: 1,
    manifest: "m",
    provider: "Ollama",
    model: "llama3",
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, json: async () => answer })),
  );
  expect((await askAi(graph, "why?")).warnings).toEqual(["Question redacted"]);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      json: async () => ({ ...answer, model: "" }),
    })),
  );
  await expect(askAi(graph, "why?")).rejects.toMatchObject({
    code: "INVALID_RESPONSE",
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      json: async () => ({ ...config, local: "yes" }),
    })),
  );
  await expect(getAiConfig()).rejects.toMatchObject({
    code: "INVALID_RESPONSE",
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      json: async () => ({ ...config, endpointUrl: "not a URL" }),
    })),
  );
  await expect(getAiConfig()).rejects.toMatchObject({
    code: "INVALID_RESPONSE",
  });
});
