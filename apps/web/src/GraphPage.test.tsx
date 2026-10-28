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
    screen.getByRole("button", { name: "2D Graph" }).hasAttribute("disabled"),
  ).toBe(false);
  await user.type(
    screen.getByRole("searchbox", { name: "Search files" }),
    "services/",
  );
  const list = screen.getByRole("list", { name: "Graph files" });
  expect(
    within(list).getByRole("button", { name: "Collapse services" }),
  ).toBeTruthy();
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

it("keeps disconnected binary and unknown files searchable with truthful inspection", async () => {
  const universal: Graph = {
    ...graph,
    files: [
      ...graph.files,
      {
        id: "png",
        path: "assets/logo.png",
        name: "logo.png",
        parent: "assets",
        language: "Image",
        category: "image",
        contentKind: "binary",
        sizeBytes: 5,
        status: "unsupported",
      },
      {
        id: "custom",
        path: "assets/mystery.custom",
        name: "mystery.custom",
        parent: "assets",
        language: "Unknown",
        category: "unknown",
        contentKind: "unknown",
        sizeBytes: 0,
        status: "unsupported",
      },
    ],
    counts: { ...graph.counts, files: 4 },
    partial: true,
  };
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reply(universal)));
  const user = userEvent.setup();
  render(
    <GraphPage
      repository={repo}
      connection="connected"
      onOpenRepository={() => {}}
    />,
  );
  await waitFor(() =>
    expect(screen.getByText(/4 files.*1 verified connection/)).toBeTruthy(),
  );
  await user.type(
    screen.getByRole("searchbox", { name: "Search files" }),
    "logo.png",
  );
  const tree = screen.getByRole("list", { name: "Graph files" });
  await user.click(
    within(tree).getByRole("button", { name: "assets/logo.png" }),
  );
  const inspector = screen.getByRole("complementary", {
    name: "Graph file details",
  });
  expect(within(inspector).getAllByText("Image").length).toBeGreaterThan(0);
  expect(within(inspector).getByText("5 bytes")).toBeTruthy();
  expect(
    within(inspector).getByText(/Not analyzed for this file format/),
  ).toBeTruthy();
  expect(within(inspector).getByText("assets/logo.png")).toBeTruthy();
  await user.clear(screen.getByRole("searchbox", { name: "Search files" }));
  await user.type(
    screen.getByRole("searchbox", { name: "Search files" }),
    "mystery.custom",
  );
  await user.click(
    within(tree).getByRole("button", { name: "assets/mystery.custom" }),
  );
  expect(within(inspector).getAllByText("Unknown").length).toBeGreaterThan(0);
});

it("opens real M2 declarations in the detail scaffold and follows a directed dependency", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reply(graph)));
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
  const list = screen.getByRole("list", { name: "Graph files" });
  await user.click(
    within(list).getByRole("button", { name: /services\/entry.ts/ }),
  );
  const workbench = screen.getByRole("region", { name: "File workbench" });
  expect(within(workbench).getByText("../shared/entry")).toBeTruthy();
  expect(
    within(workbench).getByText(/Open file details to read source/),
  ).toBeTruthy();
  await user.click(
    within(workbench).getByRole("button", { name: "Open file details" }),
  );
  const detail = screen.getByRole("region", { name: "File detail" });
  expect(
    within(detail).getByText("services/entry.ts", {
      selector: ".archive-article-head p",
    }),
  ).toBeTruthy();
  const notes = within(detail).getByRole("complementary", {
    name: "File relationship notes",
  });
  await user.click(
    within(notes).getByRole("button", { name: "shared/entry.ts" }),
  );
  expect(
    within(detail).getByText("shared/entry.ts", {
      selector: ".archive-article-head p",
    }),
  ).toBeTruthy();
  expect(within(notes).getByText("Referenced by")).toBeTruthy();
  await user.click(
    within(detail).getByRole("button", { name: "Graph workspace" }),
  );
  expect(
    screen.getByRole("complementary", { name: "Graph file details" })
      .textContent,
  ).toContain("shared/entry.ts");
});

it("resolves a repository-explorer path to the same file detail, without inventing unsupported files", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reply(graph)));
  const view = render(
    <GraphPage
      repository={repo}
      initialPath="shared/entry.ts"
      connection="connected"
      onOpenRepository={() => {}}
    />,
  );
  await waitFor(() =>
    expect(screen.getByRole("region", { name: "File detail" })).toBeTruthy(),
  );
  expect(
    screen.getByText("shared/entry.ts", {
      selector: ".archive-article-head p",
    }),
  ).toBeTruthy();
  view.rerender(
    <GraphPage
      repository={repo}
      initialPath="unindexed/readme.md"
      connection="connected"
      onOpenRepository={() => {}}
    />,
  );
  expect(screen.getByText(/not in the current analyzed graph/)).toBeTruthy();
  expect(screen.queryByRole("region", { name: "File detail" })).toBeNull();
});

it("opens a manifest-bound Findings file directly in the selected 2D workspace", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reply(graph)));
  render(
    <GraphPage
      repository={repo}
      initialPath="shared/entry.ts"
      initialManifest={graph.manifest}
      mode="2d"
      connection="connected"
      onOpenRepository={() => {}}
    />,
  );
  expect(
    await screen.findByRole("group", { name: /file map with verified/ }),
  ).toBeTruthy();
  await waitFor(() =>
    expect(
      screen.getByRole("complementary", { name: "Graph file details" })
        .textContent,
    ).toContain("shared/entry.ts"),
  );
  expect(screen.queryByRole("region", { name: "File detail" })).toBeNull();
});

it("refuses a Findings file from a different same-revision manifest", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reply(graph)));
  render(
    <GraphPage
      repository={repo}
      initialPath="shared/entry.ts"
      initialManifest="old-manifest"
      mode="2d"
      connection="connected"
      onOpenRepository={() => {}}
    />,
  );
  expect(
    await screen.findByText(/graph has changed since Findings was opened/),
  ).toBeTruthy();
  expect(
    screen.getByRole("complementary", { name: "Graph file details" })
      .textContent,
  ).not.toContain("shared/entry.ts");
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

it("shows an honest zero-file state and partial parse diagnostics", async () => {
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
    expect(screen.getByText("No eligible files.")).toBeTruthy(),
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
  expect(screen.getAllByText("other").length).toBeGreaterThan(0);
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

it.each(["NO_REPOSITORY_SELECTED", "STALE_REPOSITORY"])(
  "invalidates an obsolete selection on %s and offers repository recovery",
  async (code) => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(reply({ error: { code } }, 409)),
    );
    const stale = vi.fn();
    const open = vi.fn();
    const view = render(
      <GraphPage
        repository={repo}
        connection="connected"
        onOpenRepository={open}
        onStale={stale}
      />,
    );
    await waitFor(() => expect(stale).toHaveBeenCalledOnce());
    view.rerender(
      <GraphPage
        repository={null}
        connection="connected"
        onOpenRepository={open}
        onStale={stale}
      />,
    );
    expect(screen.getByText("No repository selected.")).toBeTruthy();
    await userEvent.click(
      screen.getByRole("button", { name: "Open repository" }),
    );
    expect(open).toHaveBeenCalledOnce();
  },
);

it("keeps the file explorer accessible when a narrow-layout panel opens", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reply(graph)));
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
  await user.click(screen.getByRole("button", { name: "Files (2)" }));
  expect(
    screen
      .getByRole("button", { name: "Files (2)" })
      .getAttribute("aria-expanded"),
  ).toBe("true");
  expect(
    screen.getByRole("button", { name: "Collapse services" }),
  ).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Inspector" }));
  expect(
    screen
      .getByRole("button", { name: "Inspector" })
      .getAttribute("aria-expanded"),
  ).toBe("true");
});

it("recognizes NO_GRAPH after another tab switches the selected repository", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) =>
      url.endsWith("/graph")
        ? reply({ error: { code: "NO_GRAPH" } }, 409)
        : reply({ ...repo, repositoryId: "r2" }),
    ),
  );
  const stale = vi.fn();
  render(
    <GraphPage
      repository={repo}
      connection="connected"
      onOpenRepository={() => {}}
      onStale={stale}
    />,
  );
  await waitFor(() => expect(stale).toHaveBeenCalledOnce());
  expect(screen.queryByText(/2 files.*1 verified connection/)).toBeNull();
});
