import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Assistant } from "./Assistant";
import type { Graph } from "./graphApi";

const graph = {
  repositoryId: "r",
  revision: 1,
  manifest: "m",
  schemaVersion: 1,
  analyzerVersion: "a",
  directories: [],
  files: [
    {
      id: "a",
      path: "a.ts",
      name: "a.ts",
      parent: ".",
      language: "TypeScript",
      status: "parsed",
    },
  ],
  edges: [],
  diagnostics: [],
  counts: { files: 1, resolved: 0, unresolved: 0, skipped: 0, bytes: 2 },
  partial: false,
} as Graph;
const reply = (value: unknown) => ({ ok: true, json: async () => value });
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it("asks only with enabled consent, cancels and refuses stale or unverified citation navigation", async () => {
  let resolveAsk!: (value: ReturnType<typeof reply>) => void;
  const fetcher = vi.fn((url: string) => {
    if (url.endsWith("/config"))
      return Promise.resolve(
        reply({
          enabled: true,
          provider: "openai",
          model: "gpt-4o-mini",
          hasKey: true,
          consent: true,
        }),
      );
    if (url.endsWith("/graph")) return Promise.resolve(reply(graph));
    if (url.endsWith("/ask"))
      return new Promise<ReturnType<typeof reply>>((resolve) => {
        resolveAsk = resolve;
      });
    return Promise.resolve(reply({}));
  });
  vi.stubGlobal("fetch", fetcher);
  const onCitation = vi.fn();
  const user = userEvent.setup();
  render(
    <Assistant
      graph={graph}
      selected={graph.files[0]}
      connection="connected"
      onOpenSettings={() => {}}
      onCitation={onCitation}
    />,
  );
  await screen.findByText(/External transmission enabled/);
  expect(
    screen.getByText(/repository r · revision 1 · snapshot m · a.ts/),
  ).toBeTruthy();
  await user.click(
    screen.getByRole("button", { name: "What does a.ts depend on?" }),
  );
  expect(
    screen.getByRole("textbox", { name: /Question about/ }),
  ).toHaveProperty("value", "What does a.ts depend on?");
  await user.clear(screen.getByRole("textbox", { name: /Question about/ }));
  await user.type(
    screen.getByRole("textbox", { name: /Question about/ }),
    "What is this?",
  );
  await user.click(screen.getByRole("button", { name: "Ask assistant" }));
  await waitFor(() =>
    expect(fetcher.mock.calls.some(([url]) => url.endsWith("/ask"))).toBe(true),
  );
  await user.click(screen.getByRole("button", { name: "Cancel request" }));
  resolveAsk(
    reply({
      status: "cited",
      answer: "late",
      citations: [],
      limitations: [],
      warnings: [],
      repositoryId: "r",
      revision: 1,
      manifest: "m",
      provider: "openai",
      model: "gpt-4o-mini",
    }),
  );
  expect(screen.queryByText("late")).toBeNull();
  await user.click(screen.getByRole("button", { name: "Ask assistant" }));
  resolveAsk(
    reply({
      status: "cited",
      answer: "answer",
      citations: [
        {
          fileId: "a",
          path: "a.ts",
          category: "file",
          freshness: "unverified",
        },
      ],
      limitations: ["Partial context"],
      warnings: [],
      repositoryId: "r",
      revision: 1,
      manifest: "m",
      provider: "openai",
      model: "gpt-4o-mini",
    }),
  );
  await screen.findByText("answer");
  expect(screen.getByText(/Unverified citation/)).toBeTruthy();
  expect(onCitation).not.toHaveBeenCalled();
});

it("revalidates a cited line against live source before opening detail", async () => {
  const citation = {
    fileId: "a",
    path: "a.ts",
    startLine: 2,
    category: "source",
    freshness: "verified",
  };
  const fetcher = vi.fn(async (url: string) => {
    if (url.endsWith("/config"))
      return reply({
        enabled: true,
        provider: "openai",
        model: "gpt-4o-mini",
        hasKey: true,
        consent: true,
      });
    if (url.endsWith("/graph")) return reply(graph);
    if (url.endsWith("/ask"))
      return reply({
        status: "cited",
        answer: "cited",
        citations: [citation],
        limitations: [],
        warnings: [],
        repositoryId: "r",
        revision: 1,
        manifest: "m",
        provider: "openai",
        model: "gpt-4o-mini",
      });
    return reply({
      repositoryId: "r",
      revision: 1,
      manifest: "m",
      fileId: "a",
      path: "a.ts",
      name: "a.ts",
      language: "TypeScript",
      status: "parsed",
      freshness: "verified",
      text: "a\nb",
      lineCount: 2,
    });
  });
  vi.stubGlobal("fetch", fetcher);
  const onCitation = vi.fn();
  const user = userEvent.setup();
  render(
    <Assistant
      graph={graph}
      selected={null}
      connection="connected"
      onOpenSettings={() => {}}
      onCitation={onCitation}
    />,
  );
  await screen.findByText(/External transmission enabled/);
  await user.type(
    screen.getByRole("textbox", { name: /Question about/ }),
    "Explain",
  );
  await user.click(screen.getByRole("button", { name: "Ask assistant" }));
  await user.click(await screen.findByRole("button", { name: /a.ts:2/ }));
  await waitFor(() => expect(onCitation).toHaveBeenCalledWith(citation));
  expect(fetcher.mock.calls.some(([url]) => url.includes("/source?"))).toBe(
    true,
  );
});
