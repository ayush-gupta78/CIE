import { afterEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FindingsPage } from "./FindingsPage";
import { getGraph, analyzeRepository } from "./graphApi";
import type { Graph } from "./graphApi";
import { getInsights, getImpact, type Insights } from "./findingsApi";
import { ApiError, currentRepository } from "./repositoryApi";
vi.mock("./graphApi", () => ({
  getGraph: vi.fn(),
  analyzeRepository: vi.fn(),
}));
vi.mock("./findingsApi", () => ({ getInsights: vi.fn(), getImpact: vi.fn() }));
vi.mock("./repositoryApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./repositoryApi")>()),
  currentRepository: vi.fn(),
}));
const repository = {
  selected: true as const,
  repositoryId: "r",
  revision: 1,
  rootName: "root",
};
const files: Insights["files"] = [
  {
    id: "a",
    path: "src/a.ts",
    parent: "src",
    status: "parsed",
    directDependencies: 0,
    directDependents: 1,
    transitiveDependencies: 0,
    transitiveDependents: 1,
    cycleIds: [],
  },
  {
    id: "b",
    path: "lib/a.ts",
    parent: "lib",
    status: "partial",
    directDependencies: 1,
    directDependents: 0,
    transitiveDependencies: 1,
    transitiveDependents: 0,
    cycleIds: [],
  },
];
const graph = {
  repositoryId: "r",
  revision: 1,
  manifest: "hash",
  diagnostics: [],
  files: files.map((f) => ({ id: f.id, path: f.path })),
};
const insights: Insights = {
  repositoryId: "r",
  revision: 1,
  manifest: "hash",
  files,
  cycles: [],
  totals: {
    files: 2,
    relationships: 1,
    declarations: 1,
    unresolved: 0,
    external: 0,
    cycleGroups: 0,
    cycleFiles: 0,
    isolated: 0,
    statuses: { parsed: 1, partial: 1, unsupported: 0, skipped: 0, failed: 0 },
  },
};
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
it("loads real findings, searches and opens duplicate basenames using canonical paths", async () => {
  vi.mocked(getGraph).mockResolvedValue(graph as never);
  vi.mocked(getInsights).mockResolvedValue(insights);
  vi.mocked(getImpact).mockResolvedValue({
    repositoryId: "r",
    revision: 1,
    manifest: "hash",
    fileId: "b",
    total: 0,
    direct: [],
    indirect: [],
    affected: [],
  });
  const onOpenGraph = vi.fn();
  const user = userEvent.setup();
  render(
    <FindingsPage
      repository={repository}
      connection="connected"
      onOpenRepository={vi.fn()}
      onOpenGraph={onOpenGraph}
    />,
  );
  expect(await screen.findByRole("heading", { name: "Findings" })).toBeTruthy();
  expect(await screen.findByText("lib/a.ts")).toBeTruthy();
  await user.type(
    screen.getByRole("searchbox", { name: "Search findings" }),
    "lib/",
  );
  expect(screen.queryByText("src/a.ts")).toBeNull();
  await user.click(screen.getByRole("button", { name: "Select lib/a.ts" }));
  expect(getImpact).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Run impact analysis" }));
  await waitFor(() =>
    expect(getImpact).toHaveBeenCalledWith(
      repository,
      graph,
      "b",
      expect.anything(),
    ),
  );
  await user.click(
    screen.getByRole("button", { name: "Open lib/a.ts in 2D Graph" }),
  );
  expect(onOpenGraph).toHaveBeenCalledWith("lib/a.ts", "hash", "2d");
});

it("opens impacted and cycle files in the real graph and sorts transitive connectivity", async () => {
  const c = {
    ...files[0],
    id: "c",
    path: "zz/a.ts",
    parent: "zz",
    transitiveDependents: 3,
  };
  vi.mocked(getGraph).mockResolvedValue({
    ...graph,
    files: [...graph.files, c],
  } as never);
  vi.mocked(getInsights).mockResolvedValue({
    ...insights,
    files: [...files, c],
    totals: { ...insights.totals, files: 3, cycleGroups: 1, cycleFiles: 2 },
    cycles: [
      {
        id: 1,
        files: ["a", "b"],
        relationships: [
          { from: "a", to: "b" },
          { from: "b", to: "a" },
        ],
        witness: ["a", "b", "a"],
      },
    ],
  });
  vi.mocked(getImpact).mockResolvedValue({
    repositoryId: "r",
    revision: 1,
    manifest: "hash",
    fileId: "a",
    total: 1,
    direct: ["b"],
    indirect: [],
    affected: [
      {
        id: "b",
        path: "lib/a.ts",
        parent: "lib",
        distance: 1,
        chain: ["a", "b"],
      },
    ],
  });
  const onOpenGraph = vi.fn();
  const user = userEvent.setup();
  render(
    <FindingsPage
      repository={repository}
      connection="connected"
      onOpenRepository={vi.fn()}
      onOpenGraph={onOpenGraph}
    />,
  );
  await screen.findByRole("button", { name: "Select src/a.ts" });
  await user.selectOptions(
    screen.getByRole("combobox", { name: "Sort by" }),
    "transitiveDependents",
  );
  expect(
    document
      .querySelector(".findings-list li button")
      ?.getAttribute("aria-label"),
  ).toBe("Select zz/a.ts");
  await user.click(screen.getByRole("button", { name: "Select src/a.ts" }));
  await user.click(screen.getByRole("button", { name: "Run impact analysis" }));
  await screen.findByRole("button", { name: "Select impacted lib/a.ts" });
  await user.click(
    screen.getByRole("button", { name: "Select impacted lib/a.ts" }),
  );
  expect(screen.getByRole("heading", { name: "lib/a.ts" })).toBeTruthy();
  await user.click(
    screen.getByRole("button", { name: "Open src/a.ts from cycle 1" }),
  );
  expect(onOpenGraph).toHaveBeenCalledWith("src/a.ts", "hash", "2d");
  expect(screen.getByText("src/a.ts → lib/a.ts")).toBeTruthy();
});
it("keeps published findings on failed reanalysis and invalidates them after success", async () => {
  vi.mocked(getGraph).mockResolvedValue(graph as never);
  vi.mocked(getInsights)
    .mockResolvedValueOnce(insights)
    .mockResolvedValueOnce({ ...insights, manifest: "next" });
  vi.mocked(analyzeRepository)
    .mockRejectedValueOnce(new Error("retry later"))
    .mockResolvedValueOnce({ ...graph, manifest: "next" } as never);
  const user = userEvent.setup();
  render(
    <FindingsPage
      repository={repository}
      connection="connected"
      onOpenRepository={vi.fn()}
      onOpenGraph={vi.fn()}
    />,
  );
  expect(await screen.findByText("lib/a.ts")).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Re-analyze" }));
  expect(await screen.findByRole("alert")).toHaveProperty(
    "textContent",
    expect.stringContaining("retry later"),
  );
  expect(screen.getByText("lib/a.ts")).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Re-analyze" }));
  await waitFor(() =>
    expect(getInsights).toHaveBeenCalledWith(
      repository,
      expect.objectContaining({ manifest: "next" }),
      expect.anything(),
    ),
  );
  expect(await screen.findByText("lib/a.ts")).toBeTruthy();
});
it("drops old metrics when analysis succeeds but fresh insights fail", async () => {
  vi.mocked(getGraph).mockResolvedValue(graph as never);
  vi.mocked(getInsights)
    .mockResolvedValueOnce(insights)
    .mockRejectedValueOnce(new Error("insights unavailable"));
  vi.mocked(analyzeRepository).mockResolvedValue({
    ...graph,
    manifest: "next",
  } as never);
  render(
    <FindingsPage
      repository={repository}
      connection="connected"
      onOpenRepository={vi.fn()}
      onOpenGraph={vi.fn()}
    />,
  );
  expect(await screen.findByText("lib/a.ts")).toBeTruthy();
  await userEvent.click(screen.getByRole("button", { name: "Re-analyze" }));
  expect(await screen.findByRole("alert")).toHaveProperty(
    "textContent",
    expect.stringContaining("insights unavailable"),
  );
  expect(screen.queryByText("lib/a.ts")).toBeNull();
});

it("discards an old findings response after switching repositories", async () => {
  let finish!: (data: Insights) => void;
  vi.mocked(getGraph)
    .mockResolvedValueOnce(graph as never)
    .mockResolvedValueOnce({
      ...graph,
      repositoryId: "other",
      revision: 2,
    } as never);
  vi.mocked(getInsights)
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    )
    .mockResolvedValueOnce({ ...insights, repositoryId: "other", revision: 2 });
  const view = render(
    <FindingsPage
      repository={repository}
      connection="connected"
      onOpenRepository={vi.fn()}
      onOpenGraph={vi.fn()}
    />,
  );
  await waitFor(() => expect(getInsights).toHaveBeenCalledTimes(1));
  view.rerender(
    <FindingsPage
      repository={{ ...repository, repositoryId: "other", revision: 2 }}
      connection="connected"
      onOpenRepository={vi.fn()}
      onOpenGraph={vi.fn()}
    />,
  );
  finish(insights);
  expect(await screen.findByText("lib/a.ts")).toBeTruthy();
  expect(screen.getByRole("heading", { name: "Findings" })).toBeTruthy();
  expect(getInsights).toHaveBeenCalledTimes(2);
});

it("revalidates the manifest on window focus after another tab reanalyzes the same revision", async () => {
  let finish!: (value: Graph) => void;
  vi.mocked(getGraph)
    .mockResolvedValueOnce(graph as never)
    .mockImplementationOnce(
      () =>
        new Promise<Graph>((resolve) => {
          finish = resolve;
        }),
    );
  vi.mocked(getInsights)
    .mockResolvedValueOnce(insights)
    .mockResolvedValueOnce({ ...insights, manifest: "next" });
  render(
    <FindingsPage
      repository={repository}
      connection="connected"
      onOpenRepository={vi.fn()}
      onOpenGraph={vi.fn()}
    />,
  );
  await screen.findByRole("button", { name: "Select lib/a.ts" });
  fireEvent.focus(window);
  await waitFor(() => expect(getGraph).toHaveBeenCalledTimes(2));
  expect(screen.queryByRole("button", { name: "Select lib/a.ts" })).toBeNull();
  finish({ ...graph, manifest: "next" } as unknown as Graph);
  await screen.findByRole("button", { name: "Select lib/a.ts" });
  expect(getInsights).toHaveBeenLastCalledWith(
    repository,
    expect.objectContaining({ manifest: "next" }),
    expect.anything(),
  );
});

it("reconciles an invalid graph response against a switched repository", async () => {
  vi.mocked(getGraph).mockRejectedValue(
    new ApiError("INVALID_RESPONSE", "Graph identity changed"),
  );
  vi.mocked(currentRepository).mockResolvedValue({
    ...repository,
    repositoryId: "other",
  });
  const onStale = vi.fn();
  render(
    <FindingsPage
      repository={repository}
      connection="connected"
      onOpenRepository={vi.fn()}
      onOpenGraph={vi.fn()}
      onStale={onStale}
    />,
  );
  await waitFor(() => expect(onStale).toHaveBeenCalledOnce());
  expect(screen.queryByRole("alert")).toBeNull();
});

it("refreshes stale impact against a new manifest at the same revision", async () => {
  vi.mocked(getGraph)
    .mockResolvedValueOnce(graph as never)
    .mockResolvedValueOnce({ ...graph, manifest: "next" } as never);
  vi.mocked(getInsights)
    .mockResolvedValueOnce(insights)
    .mockResolvedValueOnce({ ...insights, manifest: "next" });
  vi.mocked(getImpact).mockRejectedValueOnce(
    new ApiError("STALE_REPOSITORY", "Graph changed"),
  );
  vi.mocked(currentRepository).mockResolvedValue(repository);
  const user = userEvent.setup();
  render(
    <FindingsPage
      repository={repository}
      connection="connected"
      onOpenRepository={vi.fn()}
      onOpenGraph={vi.fn()}
    />,
  );
  await screen.findByRole("button", { name: "Select src/a.ts" });
  await user.click(screen.getByRole("button", { name: "Select src/a.ts" }));
  await user.click(screen.getByRole("button", { name: "Run impact analysis" }));
  await waitFor(() => expect(getGraph).toHaveBeenCalledTimes(2));
  await waitFor(() =>
    expect(getInsights).toHaveBeenLastCalledWith(
      repository,
      expect.objectContaining({ manifest: "next" }),
      expect.anything(),
    ),
  );
  expect(screen.queryByRole("heading", { name: "src/a.ts" })).toBeNull();
});

it("drops old findings if reanalysis discovers a switched repository", async () => {
  vi.mocked(getGraph).mockResolvedValue(graph as never);
  vi.mocked(getInsights).mockResolvedValue(insights);
  vi.mocked(analyzeRepository).mockRejectedValue(
    new ApiError("STALE_REPOSITORY", "Repository changed"),
  );
  vi.mocked(currentRepository).mockResolvedValue({
    ...repository,
    repositoryId: "other",
  });
  const onStale = vi.fn();
  render(
    <FindingsPage
      repository={repository}
      connection="connected"
      onOpenRepository={vi.fn()}
      onOpenGraph={vi.fn()}
      onStale={onStale}
    />,
  );
  await screen.findByRole("button", { name: "Select src/a.ts" });
  await userEvent.click(screen.getByRole("button", { name: "Re-analyze" }));
  await waitFor(() => expect(onStale).toHaveBeenCalledOnce());
  expect(screen.queryByRole("button", { name: "Select src/a.ts" })).toBeNull();
});

it("removes published metrics if the graph disappears during a connection recovery", async () => {
  vi.mocked(getGraph)
    .mockResolvedValueOnce(graph as never)
    .mockRejectedValueOnce(new ApiError("NO_GRAPH", "Analyze first"));
  vi.mocked(getInsights).mockResolvedValue(insights);
  vi.mocked(currentRepository).mockResolvedValue(repository);
  const props = { repository, onOpenRepository: vi.fn(), onOpenGraph: vi.fn() };
  const view = render(<FindingsPage {...props} connection="connected" />);
  await screen.findByRole("button", { name: "Select src/a.ts" });
  view.rerender(<FindingsPage {...props} connection="disconnected" />);
  view.rerender(<FindingsPage {...props} connection="connected" />);
  await waitFor(() => expect(getGraph).toHaveBeenCalledTimes(2));
  expect(await screen.findByText(/No analysis yet/)).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Select src/a.ts" })).toBeNull();
});

it("shows no-repository and offline states without inventing metrics", () => {
  render(
    <FindingsPage
      repository={null}
      connection="disconnected"
      onOpenRepository={vi.fn()}
      onOpenGraph={vi.fn()}
    />,
  );
  expect(screen.getByText(/No repository selected/)).toBeTruthy();
  expect(screen.queryByText("0 files")).toBeNull();
});
