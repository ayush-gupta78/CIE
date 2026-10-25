import { afterEach, expect, it, vi } from "vitest";
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { GraphPage } from "./GraphPage";
import type { Graph } from "./graphApi";

const repo = {
  selected: true as const,
  repositoryId: "r1",
  revision: 1,
  rootName: "fixture",
};
const files: Graph["files"] = [
  {
    id: "a",
    path: "services/entry.ts",
    name: "entry.ts",
    parent: "services",
    language: "TypeScript",
    status: "parsed",
    sha256: "a",
  },
  {
    id: "b",
    path: "shared/entry.ts",
    name: "entry.ts",
    parent: "shared",
    language: "TypeScript",
    status: "parsed",
    sha256: "b",
  },
];
const graph: Graph = {
  schemaVersion: 1,
  analyzerVersion: "m2-ts-2",
  manifest: "m1",
  repositoryId: "r1",
  revision: 1,
  directories: ["services", "shared"],
  files,
  edges: [
    {
      id: "e",
      from: "a",
      to: "b",
      kind: "imports",
      resolution: "resolved_static",
      specifier: "../shared/entry",
      evidence: {
        path: "services/entry.ts",
        line: 1,
        column: 1,
        rule: "unique-relative-file",
        sha256: "a",
      },
    },
  ],
  diagnostics: [],
  counts: { files: 2, resolved: 1, unresolved: 0, skipped: 0, bytes: 40 },
  partial: false,
};
const reply = (value: unknown, status = 200) => ({
  ok: status < 400,
  status,
  json: async () => value,
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("offers explicit analysis, then syncs search, file list and graph-only inspector", async () => {
  const fetcher = vi.fn(async (url: string) =>
    url.endsWith("/graph")
      ? reply({ error: { code: "NO_GRAPH" } }, 409)
      : reply(graph),
  );
  vi.stubGlobal("fetch", fetcher);
  const user = userEvent.setup();
  render(
    <GraphPage
      repository={repo}
      connection="connected"
      onOpenRepository={() => {}}
    />,
  );
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Analyze repository" }),
    ).toBeTruthy(),
  );
  await user.click(screen.getByRole("button", { name: "Analyze repository" }));
  await waitFor(() =>
    expect(screen.getByText(/2 files.*1 verified connection/)).toBeTruthy(),
  );
  expect(
    screen.getByRole("button", { name: /2D.*M4/ }).hasAttribute("disabled"),
  ).toBe(true);
  await user.type(
    screen.getByRole("searchbox", { name: "Search files" }),
    "services/",
  );
  const list = screen.getByRole("list", { name: "Graph files" });
  expect(within(list).getAllByRole("button")).toHaveLength(1);
  await user.click(
    within(list).getByRole("button", { name: /services\/entry.ts/ }),
  );
  const inspector = screen.getByRole("complementary", {
    name: "Graph file details",
  });
  expect(within(inspector).getByText("services/entry.ts")).toBeTruthy();
  expect(within(inspector).getByText(/Outgoing \/ uses.*1/)).toBeTruthy();
  await user.click(
    within(inspector).getByRole("button", { name: /shared\/entry.ts/ }),
  );
  expect(within(inspector).getByText("shared/entry.ts")).toBeTruthy();
  expect(
    within(inspector).getByText(/Incoming \/ referenced by.*1/),
  ).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Clear selection" }));
  expect(
    within(inspector).getByText("Select a file to trace its relationships."),
  ).toBeTruthy();
  expect(
    fetcher.mock.calls.some(([url]) => String(url).endsWith("/analyze")),
  ).toBe(true);
});

it("ignores an old graph response after a repository revision change", async () => {
  let resolveOld!: (value: ReturnType<typeof reply>) => void;
  const pending = new Promise<ReturnType<typeof reply>>((resolve) => {
    resolveOld = resolve;
  });
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) =>
      url.endsWith("/graph") ? pending : Promise.resolve(reply(graph)),
    ),
  );
  const view = render(
    <GraphPage
      repository={repo}
      connection="connected"
      onOpenRepository={() => {}}
    />,
  );
  view.rerender(
    <GraphPage
      repository={{ ...repo, repositoryId: "r2", revision: 2 }}
      connection="connected"
      onOpenRepository={() => {}}
    />,
  );
  resolveOld(reply(graph));
  await waitFor(() =>
    expect(screen.queryByText(/2 files.*1 verified connection/)).toBeNull(),
  );
});

it("preserves the selected graph through routine health checks", async () => {
  const fetcher = vi.fn().mockResolvedValue(reply(graph));
  vi.stubGlobal("fetch", fetcher);
  const view = render(
    <GraphPage
      repository={repo}
      connection="connected"
      onOpenRepository={() => {}}
    />,
  );
  await waitFor(() =>
    expect(screen.getByText(/2 files.*1 verified connection/)).toBeTruthy(),
  );
  await userEvent.click(
    within(screen.getByRole("list", { name: "Graph files" })).getByRole(
      "button",
      { name: /services\/entry.ts/ },
    ),
  );
  view.rerender(
    <GraphPage
      repository={repo}
      connection="checking"
      onOpenRepository={() => {}}
    />,
  );
  expect(screen.queryByText(/Local API is offline/)).toBeNull();
  view.rerender(
    <GraphPage
      repository={repo}
      connection="connected"
      onOpenRepository={() => {}}
    />,
  );
  expect(
    screen.getByRole("complementary", { name: "Graph file details" })
      .textContent,
  ).toContain("services/entry.ts");
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it("shows a usable data alternative when WebGL is unavailable", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reply(graph)));
  render(
    <GraphPage
      repository={repo}
      connection="connected"
      onOpenRepository={() => {}}
    />,
  );
  await waitFor(() =>
    expect(screen.getByText(/3D rendering unavailable/)).toBeTruthy(),
  );
  expect(screen.getByRole("list", { name: "Graph files" })).toBeTruthy();
});

it("shows an honest zero-source state and partial parse diagnostics", async () => {
  const empty: Graph = {
    ...graph,
    files: [],
    edges: [],
    directories: [],
    counts: { files: 0, resolved: 0, unresolved: 0, skipped: 0, bytes: 0 },
    partial: false,
  };
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reply(empty)));
  const view = render(
    <GraphPage
      repository={repo}
      connection="connected"
      onOpenRepository={() => {}}
    />,
  );
  await waitFor(() =>
    expect(screen.getByText("No supported source files.")).toBeTruthy(),
  );
  expect(screen.queryByText("services/entry.ts")).toBeNull();
  view.unmount();
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      reply({
        ...graph,
        partial: true,
        diagnostics: [
          { path: "shared/entry.ts", code: "PARSE_ERROR", line: 3 },
        ],
      }),
    ),
  );
  render(
    <GraphPage
      repository={repo}
      connection="connected"
      onOpenRepository={() => {}}
    />,
  );
  await waitFor(() =>
    expect(screen.getByText(/PARSE_ERROR.*shared\/entry.ts:3/)).toBeTruthy(),
  );
  expect(
    screen
      .getAllByRole("status")
      .some((status) => status.textContent?.includes("Partial analysis")),
  ).toBe(true);
});

it("keeps a same-revision graph visible when re-analysis fails", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) =>
      url.endsWith("/graph")
        ? reply(graph)
        : reply({ error: { code: "ANALYSIS_LIMIT" } }, 422),
    ),
  );
  const user = userEvent.setup();
  render(
    <GraphPage
      repository={repo}
      connection="connected"
      onOpenRepository={() => {}}
    />,
  );
  await waitFor(() =>
    expect(screen.getByText(/2 files.*1 verified connection/)).toBeTruthy(),
  );
  await user.click(screen.getByRole("button", { name: "Re-analyze" }));
  await waitFor(() =>
    expect(screen.getByRole("alert").textContent).toContain("Analysis limit"),
  );
  expect(screen.getByText(/2 files.*1 verified connection/)).toBeTruthy();
});

it("shows truthful no-repository and disconnected states", async () => {
  const open = vi.fn();
  const view = render(
    <GraphPage
      repository={null}
      connection="connected"
      onOpenRepository={open}
    />,
  );
  expect(screen.getByText("No repository selected.")).toBeTruthy();
  await userEvent.click(
    screen.getByRole("button", { name: "Open repository" }),
  );
  expect(open).toHaveBeenCalledOnce();
  view.rerender(
    <GraphPage
      repository={repo}
      connection="disconnected"
      onOpenRepository={open}
    />,
  );
  expect(screen.getByRole("alert").textContent).toContain(
    "Local API is offline",
  );
  expect(
    screen
      .getByRole("button", { name: "Analyze repository" })
      .hasAttribute("disabled"),
  ).toBe(true);
});

it("ignores an old analysis response after a repository switch", async () => {
  let finish!: (value: ReturnType<typeof reply>) => void;
  const pending = new Promise<ReturnType<typeof reply>>((resolve) => {
    finish = resolve;
  });
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) =>
      url.endsWith("/graph")
        ? Promise.resolve(reply({ error: { code: "NO_GRAPH" } }, 409))
        : pending,
    ),
  );
  const user = userEvent.setup();
  const view = render(
    <GraphPage
      repository={repo}
      connection="connected"
      onOpenRepository={() => {}}
    />,
  );
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Analyze repository" }),
    ).toBeTruthy(),
  );
  await user.click(screen.getByRole("button", { name: "Analyze repository" }));
  view.rerender(
    <GraphPage
      repository={{
        ...repo,
        repositoryId: "r2",
        revision: 2,
        rootName: "other",
      }}
      connection="connected"
      onOpenRepository={() => {}}
    />,
  );
  finish(reply(graph));
  await waitFor(() =>
    expect(
      screen.getByText(
        "No analysis yet. Analyze this repository to see its real file graph.",
      ),
    ).toBeTruthy(),
  );
  expect(screen.queryByText(/2 files.*1 verified connection/)).toBeNull();
  expect(screen.getByText("other")).toBeTruthy();
});

it("finishes an analysis that spans a routine health check", async () => {
  let finish!: (value: ReturnType<typeof reply>) => void;
  const pending = new Promise<ReturnType<typeof reply>>((resolve) => {
    finish = resolve;
  });
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) =>
      url.endsWith("/graph")
        ? Promise.resolve(reply({ error: { code: "NO_GRAPH" } }, 409))
        : pending,
    ),
  );
  const user = userEvent.setup();
  const view = render(
    <GraphPage
      repository={repo}
      connection="connected"
      onOpenRepository={() => {}}
    />,
  );
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Analyze repository" }),
    ).toBeTruthy(),
  );
  await user.click(screen.getByRole("button", { name: "Analyze repository" }));
  view.rerender(
    <GraphPage
      repository={repo}
      connection="checking"
      onOpenRepository={() => {}}
    />,
  );
  view.rerender(
    <GraphPage
      repository={repo}
      connection="connected"
      onOpenRepository={() => {}}
    />,
  );
  finish(reply(graph));
  await waitFor(() =>
    expect(screen.getByText(/2 files.*1 verified connection/)).toBeTruthy(),
  );
  expect(
    screen.getByRole("button", { name: "Re-analyze" }).hasAttribute("disabled"),
  ).toBe(false);
});
