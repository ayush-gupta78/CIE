import { afterEach, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { GraphPage } from "./GraphPage";
import { GraphScene2D } from "./GraphScene2D";
import { projectGraph } from "./graphModel";
import { frameBox, layoutGraph2D } from "./graphLayout2D";
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
const pointer = (
  target: Element,
  type: string,
  id: number,
  x: number,
  y: number,
) => {
  const event = new MouseEvent(type, { bubbles: true, clientX: x, clientY: y });
  Object.defineProperty(event, "pointerId", { value: id });
  fireEvent(target, event);
};
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

it("keeps a deliberate Fit view after resize rather than replaying an old file focus", async () => {
  let resize: (
    entries: { contentRect: { width: number; height: number } }[],
  ) => void = () => {};
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: typeof resize) {
        resize = callback;
      }
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reply(graph)));
  render(
    <GraphPage
      repository={repo}
      mode="2d"
      connection="connected"
      onOpenRepository={() => {}}
    />,
  );
  await screen.findByRole("group", { name: /3 file map/ });
  await userEvent.click(
    within(screen.getByRole("group", { name: /3 file map/ })).getByRole(
      "button",
      { name: "web/index.ts" },
    ),
  );
  await userEvent.click(screen.getByRole("button", { name: "Focus selected" }));
  await userEvent.click(screen.getByRole("button", { name: "Fit view" }));
  act(() => resize([{ contentRect: { width: 320, height: 300 } }]));
  const actual = Number(
    document
      .querySelector(".graph-2d svg > g")
      ?.getAttribute("transform")
      ?.match(/scale\(([^)]+)\)/)?.[1],
  );
  expect(actual).toBeCloseTo(
    frameBox(layoutGraph2D(projectGraph(graph)).bounds, 320, 300).scale,
  );
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

it("uses only circular file markers, not rectangular directory or file panels", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reply(graph)));
  render(
    <GraphPage
      repository={repo}
      mode="2d"
      connection="connected"
      onOpenRepository={() => {}}
    />,
  );
  await screen.findByRole("group", { name: /3 file map/ });
  expect(
    document.querySelectorAll(".graph-2d-file .graph-2d-dot"),
  ).toHaveLength(3);
  expect(
    document.querySelectorAll(".graph-2d-file rect, .graph-2d-directory rect"),
  ).toHaveLength(0);
});

it("selects a file on the first click after panning, including release over its node", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reply(graph)));
  render(
    <GraphPage
      repository={repo}
      mode="2d"
      connection="connected"
      onOpenRepository={() => {}}
    />,
  );
  const map = await screen.findByRole("group", { name: /3 file map/ });
  const target = within(map).getByRole("button", { name: "web/index.ts" });
  Object.assign(map, {
    setPointerCapture: () => {},
    hasPointerCapture: () => false,
  });
  const before = map.querySelector("g")?.getAttribute("transform");
  pointer(map, "pointerdown", 1, 100, 100);
  pointer(map, "pointermove", 1, 145, 115);
  pointer(target, "pointerup", 1, 145, 115);
  expect(map.querySelector("g")?.getAttribute("transform")).not.toBe(before);
  await userEvent.click(target);
  expect(target.getAttribute("aria-pressed")).toBe("true");
  expect(
    screen.getByRole("complementary", { name: "Graph file details" })
      .textContent,
  ).toContain("web/index.ts");
});

it("ignores pointer jitter, resets cancelled gestures, and selects after a pinch", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reply(graph)));
  render(
    <GraphPage
      repository={repo}
      mode="2d"
      connection="connected"
      onOpenRepository={() => {}}
    />,
  );
  const map = await screen.findByRole("group", { name: /3 file map/ });
  const target = within(map).getByRole("button", { name: "web/index.ts" });
  Object.assign(map, {
    setPointerCapture: () => {},
    hasPointerCapture: () => false,
  });
  const transform = () => map.querySelector("g")?.getAttribute("transform");
  const initial = transform();
  pointer(map, "pointerdown", 1, 100, 100);
  pointer(map, "pointermove", 1, 102, 101);
  pointer(map, "pointercancel", 1, 102, 101);
  expect(transform()).toBe(initial);
  pointer(map, "pointerdown", 1, 100, 100);
  pointer(map, "pointerdown", 2, 150, 100);
  pointer(map, "pointermove", 2, 200, 100);
  pointer(map, "pointerup", 1, 100, 100);
  pointer(map, "pointerup", 2, 200, 100);
  await waitFor(() => expect(transform()).not.toBe(initial));
  await userEvent.click(target);
  expect(target.getAttribute("aria-pressed")).toBe("true");
});

it("shows reciprocal directions separately and retains source evidence", async () => {
  const reciprocal: Graph = {
    ...graph,
    edges: [
      ...graph.edges,
      {
        ...graph.edges[0],
        id: "back",
        from: "b",
        to: "a",
        evidence: {
          ...graph.edges[0].evidence,
          path: "server/index.ts",
          line: 2,
        },
      },
    ],
    counts: { ...graph.counts, resolved: 2 },
  };
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reply(reciprocal)));
  render(
    <GraphPage
      repository={repo}
      mode="2d"
      connection="connected"
      onOpenRepository={() => {}}
    />,
  );
  const map = await screen.findByRole("group", { name: /3 file map/ });
  await userEvent.click(
    within(map).getByRole("button", { name: "web/index.ts" }),
  );
  const edges = [
    ...document.querySelectorAll<SVGPathElement>(".graph-2d-edge.active"),
  ];
  expect(edges).toHaveLength(2);
  expect(new Set(edges.map((edge) => edge.getAttribute("stroke")))).toEqual(
    new Set(["#f0c98b", "#87b7ee"]),
  );
  expect(edges[0].getAttribute("d")).not.toBe(edges[1].getAttribute("d"));
  expect(
    within(
      screen.getByRole("complementary", { name: "Graph file details" }),
    ).getByText(/server\/index.ts:2:1/),
  ).toBeTruthy();
  expect(
    within(map)
      .getByRole("button", { name: "server/index.ts" })
      .classList.contains("both"),
  ).toBe(true);
});

it("highlights duplicate-name search matches and exposes full hover context", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reply(graph)));
  render(
    <GraphPage
      repository={repo}
      mode="2d"
      connection="connected"
      onOpenRepository={() => {}}
    />,
  );
  const map = await screen.findByRole("group", { name: /3 file map/ });
  await userEvent.type(
    screen.getByRole("searchbox", { name: "Search files" }),
    "index.ts",
  );
  expect(document.querySelectorAll(".graph-2d-file.search-match")).toHaveLength(
    2,
  );
  const node = within(map).getByRole("button", { name: "server/index.ts" });
  fireEvent.pointerEnter(node);
  expect(screen.getByRole("tooltip").textContent).toContain("server/index.ts");
  expect(screen.getByRole("tooltip").textContent).toContain("parsed analysis");
});

it("renders the bounded synthetic 200-file / 900-declaration graph without file labels at overview scale", () => {
  const files = Array.from({ length: 200 }, (_, i): Graph["files"][number] => ({
    id: `id${i}`,
    path: `module${i % 10}/file${i}.ts`,
    parent: `module${i % 10}`,
    name: `file${i}.ts`,
    language: "TypeScript",
    status: "parsed",
  }));
  const edges = Array.from({ length: 900 }, (_, i): Graph["edges"][number] => ({
    ...graph.edges[0],
    id: `edge${i}`,
    from: `id${i % 200}`,
    to: `id${(i + 1 + Math.floor(i / 200)) % 200}`,
  }));
  const model = projectGraph({
    ...graph,
    files,
    edges,
    counts: { ...graph.counts, files: 200, resolved: 900 },
  });
  const scene = render(
    <GraphScene2D
      model={model}
      selectedId={null}
      search=""
      onSelect={() => {}}
      focusId={null}
      focusModule={null}
      focusToken={0}
      fitToken={0}
      active
    />,
  );
  expect(document.querySelectorAll(".graph-2d-dot")).toHaveLength(200);
  expect(document.querySelectorAll(".graph-2d-edge")).toHaveLength(
    model.connections.length,
  );
  expect(model.connections.reduce((sum, edge) => sum + edge.count, 0)).toBe(
    900,
  );
  expect(document.querySelectorAll(".graph-2d-file text").length).toBeLessThan(
    25,
  );
  const ordered = [...layoutGraph2D(model).nodes].sort(
    (a, b) => a[1].x - b[1].x,
  );
  const selectedId = ordered[0][0];
  const focusId = ordered[ordered.length - 1][0];
  scene.rerender(
    <GraphScene2D
      model={model}
      selectedId={selectedId}
      search=""
      onSelect={() => {}}
      focusId={focusId}
      focusModule={null}
      focusToken={1}
      fitToken={0}
      active
    />,
  );
  expect(document.querySelector(".graph-2d-selected-name")).toBeNull();
  expect(document.querySelectorAll(".graph-2d-file.dim")).toHaveLength(0);
  expect(document.querySelectorAll(".graph-2d-edge.dim")).toHaveLength(0);
});
