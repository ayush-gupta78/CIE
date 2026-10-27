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
  repositoryId: "r",
  revision: 1,
  rootName: "fixture",
};
const files: Graph["files"] = [
  {
    id: "a",
    path: "web/index.ts",
    parent: "web",
    name: "index.ts",
    language: "TypeScript",
    status: "parsed",
  },
  {
    id: "b",
    path: "server/index.ts",
    parent: "server",
    name: "index.ts",
    language: "TypeScript",
    status: "parsed",
  },
  {
    id: "c",
    path: "docs/README.md",
    parent: "docs",
    name: "README.md",
    language: "Markdown",
    status: "unsupported",
  },
];
const graph: Graph = {
  schemaVersion: 1,
  analyzerVersion: "fixture",
  manifest: "fixture",
  repositoryId: "r",
  revision: 1,
  directories: ["web", "server", "docs"],
  files,
  edges: [
    {
      id: "one",
      from: "a",
      to: "b",
      resolution: "resolved_static",
      kind: "imports",
      specifier: "../server/index",
      evidence: {
        path: "web/index.ts",
        line: 1,
        column: 1,
        rule: "fixture",
        sha256: "hash",
      },
    },
  ],
  diagnostics: [],
  counts: { files: 3, resolved: 1, unresolved: 0, skipped: 0, bytes: 0 },
  partial: true,
};
const reply = (data: unknown) => ({
  ok: true,
  status: 200,
  json: async () => data,
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("keeps canonical selection, search and evidence through repeated mode switches without re-fetch", async () => {
  const fetcher = vi.fn().mockResolvedValue(reply(graph));
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
    expect(screen.getByText(/3 files.*1 verified connection/)).toBeTruthy(),
  );
  await user.type(
    screen.getByRole("searchbox", { name: "Search files" }),
    "index.ts",
  );
  await user.click(
    within(screen.getByRole("list", { name: "Graph files" })).getByRole(
      "button",
      { name: "web/index.ts" },
    ),
  );
  await user.click(screen.getByRole("button", { name: "2D Graph" }));
  const map = screen.getByRole("group", { name: /3 file map/ });
  expect(
    within(map)
      .getByRole("button", { name: "web/index.ts" })
      .getAttribute("aria-pressed"),
  ).toBe("true");
  const inspector = screen.getByRole("complementary", {
    name: "Graph file details",
  });
  expect(within(inspector).getByText(/web\/index.ts:1:1/)).toBeTruthy();
  await user.click(
    within(map).getByRole("button", { name: "server/index.ts" }),
  );
  expect(
    within(inspector).getByText(/Incoming \/ referenced by.*1/),
  ).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "3D Map" }));
  expect(within(inspector).getByText("server/index.ts")).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "2D Graph" }));
  expect(
    within(map)
      .getByRole("button", { name: "server/index.ts" })
      .getAttribute("aria-pressed"),
  ).toBe("true");
  expect(
    (
      screen.getByRole("searchbox", {
        name: "Search files",
      }) as HTMLInputElement
    ).value,
  ).toBe("index.ts");
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("button", { name: "Zoom in" })).toBeTruthy();
  const scale = () => document.querySelector(".graph-2d-scale")?.textContent;
  const initialScale = scale();
  await user.click(screen.getByRole("button", { name: "Zoom in" }));
  expect(scale()).not.toBe(initialScale);
  await user.click(screen.getByRole("button", { name: "Focus selected" }));
  await user.click(screen.getByRole("button", { name: "Fit view" }));
  await waitFor(() => expect(scale()).toBe(initialScale));
  await user.click(screen.getByRole("button", { name: "Focus module web" }));
  expect(scale()).not.toBe(initialScale);
});

it("works without WebGL, includes isolated unsupported files and keyboard-selectable nodes", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reply(graph)));
  render(
    <GraphPage
      repository={repo}
      mode="2d"
      connection="connected"
      onOpenRepository={() => {}}
    />,
  );
  await waitFor(() =>
    expect(screen.getByRole("group", { name: /3 file map/ })).toBeTruthy(),
  );
  const node = within(
    screen.getByRole("group", { name: /3 file map/ }),
  ).getByRole("button", { name: "docs/README.md" });
  node.focus();
  await userEvent.keyboard("{Enter}");
  expect(
    screen.getByRole("complementary", { name: "Graph file details" })
      .textContent,
  ).toContain("Not analyzed for this file format");
  expect(screen.queryByRole("button", { name: "Rotate view" })).toBeNull();
});

it("shows an explicit empty-map message and still offers finite fit controls", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      reply({
        ...graph,
        files: [],
        edges: [],
        directories: [],
        counts: { files: 0, resolved: 0, unresolved: 0, skipped: 0, bytes: 0 },
      }),
    ),
  );
  render(
    <GraphPage
      repository={repo}
      mode="2d"
      connection="connected"
      onOpenRepository={() => {}}
    />,
  );
  expect(
    await screen.findByText("No eligible files in this repository."),
  ).toBeTruthy();
  await userEvent.click(screen.getByRole("button", { name: "Fit view" }));
  expect(document.querySelector(".graph-2d-scale")?.textContent).toMatch(/%/);
});
