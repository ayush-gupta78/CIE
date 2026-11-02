import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Assistant } from "./Assistant";
import type { Graph } from "./graphApi";

const graph = {
  repositoryId: "r",
  revision: 1,
  manifest: "m",
  files: [],
  edges: [],
  diagnostics: [],
  directories: [],
  counts: { files: 0, resolved: 0, unresolved: 0, skipped: 0, bytes: 0 },
  partial: false,
  schemaVersion: 1,
  analyzerVersion: "a",
} as Graph;
const config = {
  enabled: true,
  consent: true,
  connectionStatus: "verified",
  providerName: "OpenAI",
  protocol: "openai-compatible",
  endpointUrl: "https://api.openai.com/v1/chat/completions",
  model: "gpt-4o-mini",
  authMode: "bearer",
  local: false,
  hasKey: true,
};
const reply = (data: unknown) => ({ ok: true, json: async () => data });
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("requires explicit review of the exact payload before approval and discards it on question change", async () => {
  const fetcher = vi.fn(async (url: string) => {
    if (url.endsWith("/config")) return reply(config);
    if (url.endsWith("/graph")) return reply(graph);
    if (url.endsWith("/preview"))
      return reply({
        id: "opaque",
        payload: '{"evidence":"safe"}',
        snapshot: { repositoryId: "r", revision: 1, manifest: "m" },
        destination: {
          endpoint: config.endpointUrl,
          protocol: config.protocol,
          model: config.model,
          providerName: config.providerName,
        },
        expiresAt: Date.now() + 60_000,
        warnings: [
          "Heuristic redaction cannot guarantee every credential is removed.",
        ],
      });
    if (url.endsWith("/approve"))
      return reply({
        status: "insufficient",
        answer: "No grounded answer",
        citations: [],
        limitations: [],
        warnings: [],
        repositoryId: "r",
        revision: 1,
        manifest: "m",
        provider: "openai",
        model: config.model,
      });
    return reply({});
  });
  vi.stubGlobal("fetch", fetcher);
  const user = userEvent.setup();
  render(
    <Assistant
      graph={graph}
      selected={null}
      connection="connected"
      onOpenSettings={() => {}}
      onCitation={() => {}}
    />,
  );
  await screen.findByText(/External transmission enabled/);
  const field = screen.getByRole("textbox", { name: /Question about/ });
  await user.type(field, "Explain");
  await user.click(screen.getByRole("button", { name: "Ask assistant" }));
  expect(await screen.findByText('{"evidence":"safe"}')).toBeTruthy();
  expect(fetcher.mock.calls.some(([url]) => url.endsWith("/approve"))).toBe(
    false,
  );
  await user.type(field, " more");
  expect(screen.queryByRole("button", { name: /Approve and send/ })).toBeNull();
  await user.click(screen.getByRole("button", { name: "Ask assistant" }));
  await user.click(
    await screen.findByRole("button", { name: /Approve and send/ }),
  );
  await waitFor(() =>
    expect(fetcher.mock.calls.some(([url]) => url.endsWith("/approve"))).toBe(
      true,
    ),
  );
  expect(await screen.findByText("No grounded answer")).toBeTruthy();
});
