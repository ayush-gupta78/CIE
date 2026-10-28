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
  rootName: "root",
};
const files: Graph["files"] = [
  {
    id: "a",
    path: "src/a.ts",
    name: "a.ts",
    parent: "src",
    language: "TypeScript",
    status: "parsed",
  },
  {
    id: "b",
    path: "src/b.ts",
    name: "b.ts",
    parent: "src",
    language: "TypeScript",
    status: "parsed",
  },
];
const edge = (id: string, line: number): Graph["edges"][number] => ({
  id,
  from: "a",
  to: "b",
  kind: "imports",
  resolution: "resolved_static",
  specifier: "./b",
  evidence: {
    path: "src/a.ts",
    line,
    column: 1,
    rule: "relative",
    sha256: "hash",
  },
});
const graph: Graph = {
  schemaVersion: 1,
  analyzerVersion: "m6",
  manifest: "m",
  repositoryId: "r",
  revision: 1,
  directories: ["src"],
  files,
  edges: [edge("e1", 2), edge("e2", 4)],
  diagnostics: [],
  counts: { files: 2, resolved: 2, unresolved: 0, skipped: 0, bytes: 100 },
  partial: false,
};
const source = (
  id: string,
  text = "one\nimport './b';\nthree\nimport './b';",
) => ({
  repositoryId: "r",
  revision: 1,
  manifest: "m",
  fileId: id,
  path: `src/${id}.ts`,
  name: `${id}.ts`,
  language: "TypeScript",
  status: "parsed",
  freshness: "verified",
  text,
  lineCount: text ? text.split("\n").length - Number(text.endsWith("\n")) : 0,
});
const reply = (data: unknown, status = 200) => ({
  ok: status < 400,
  status,
  json: async () => data,
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const mount = (props: Partial<React.ComponentProps<typeof GraphPage>> = {}) =>
  render(
    <GraphPage
      repository={repo}
      connection="connected"
      mode="2d"
      onOpenRepository={() => {}}
      {...props}
    />,
  );

it("loads source on detail demand, opens declaration in referencing file and preserves search and mode", async () => {
  const fetcher = vi.fn(async (url: string) =>
    url.includes("/source?")
      ? reply(source(new URL(url, "http://local").searchParams.get("fileId")!))
      : reply(graph),
  );
  vi.stubGlobal("fetch", fetcher);
  const user = userEvent.setup();
  mount();
  await screen.findByText(/2 files.*2 verified connections/);
  expect(
    fetcher.mock.calls.filter(([url]) => String(url).includes("/source?"))
      .length,
  ).toBe(0);
  await user.type(
    screen.getByRole("searchbox", { name: "Search files" }),
    "a.ts",
  );
  const tree = screen.getByRole("list", { name: "Graph files" });
  await user.click(within(tree).getByRole("button", { name: "src/a.ts" }));
  await user.click(
    screen.getByRole("button", { name: "View declaration e2 at line 4" }),
  );
  const detail = screen.getByRole("region", { name: "File detail" });
  await waitFor(() =>
    expect(
      within(detail)
        .getByRole("button", { name: "Line 4" })
        .getAttribute("aria-current"),
    ).toBe("location"),
  );
  expect(within(detail).getByText(/imports.*\.\/b.*src\/b.ts/)).toBeTruthy();
  expect(
    screen.getByRole("searchbox", { name: "Search files" }),
  ).toHaveProperty("value", "a.ts");
  expect(
    screen
      .getByRole("button", { name: "2D Graph" })
      .getAttribute("aria-pressed"),
  ).toBe("true");
  expect(
    fetcher.mock.calls.filter(([url]) => String(url).includes("/source?"))
      .length,
  ).toBe(1);
  await user.click(within(detail).getByRole("button", { name: "Line 2" }));
  expect(
    within(detail)
      .getByRole("button", { name: "Line 2" })
      .getAttribute("aria-current"),
  ).toBe("location");
});

it("ignores a previous file's late source response", async () => {
  let resolveA!: (value: ReturnType<typeof reply>) => void;
  const fetcher = vi.fn((url: string) =>
    url.includes("fileId=a")
      ? new Promise<ReturnType<typeof reply>>((resolve) => {
          resolveA = resolve;
        })
      : Promise.resolve(
          url.includes("/source?")
            ? reply(source("b", "actual b"))
            : reply(graph),
        ),
  );
  vi.stubGlobal("fetch", fetcher);
  const user = userEvent.setup();
  mount({ initialPath: "src/a.ts" });
  const detail = await screen.findByRole("region", { name: "File detail" });
  await waitFor(() =>
    expect(
      fetcher.mock.calls.some(([url]) => String(url).includes("fileId=a")),
    ).toBe(true),
  );
  await user.click(
    within(
      within(detail).getByRole("complementary", {
        name: "File detail explorer",
      }),
    ).getByRole("button", { name: "src/b.ts" }),
  );
  await within(detail).findByText("actual b");
  resolveA(reply(source("a", "wrong a")));
  await waitFor(() => expect(within(detail).queryByText("wrong a")).toBeNull());
});

it("reports stale source and offers explicit reanalysis without showing old bytes", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) =>
      url.includes("/source?")
        ? reply({ error: { code: "STALE_SOURCE" } }, 409)
        : reply(graph),
    ),
  );
  mount({ initialPath: "src/a.ts" });
  const detail = await screen.findByRole("region", { name: "File detail" });
  await within(detail).findByRole("alert");
  expect(
    within(detail).getByRole("button", { name: "Re-analyze repository" }),
  ).toBeTruthy();
  expect(
    within(detail).queryByRole("list", { name: "Source lines" }),
  ).toBeNull();
});

it("opens a manifest-bound edge only when its evidence still belongs to the graph", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) =>
      reply(url.includes("/source?") ? source("a") : graph),
    ),
  );
  mount({ initialPath: "src/a.ts", initialManifest: "m", initialEdgeId: "e1" });
  const detail = await screen.findByRole("region", { name: "File detail" });
  await waitFor(() =>
    expect(
      within(detail)
        .getByRole("button", { name: "Line 2" })
        .getAttribute("aria-current"),
    ).toBe("location"),
  );
  expect(within(detail).getByText(/imports.*\.\/b.*src\/b.ts/)).toBeTruthy();
});

it("highlights supported syntax without interpreting source markup", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) =>
      reply(
        url.includes("/source?")
          ? source("a", "const x = '<script>bad</script>';\n")
          : graph,
      ),
    ),
  );
  mount({ initialPath: "src/a.ts" });
  const detail = await screen.findByRole("region", { name: "File detail" });
  await within(detail).findByRole("list", { name: "Source lines" });
  expect(detail.querySelector(".hljs-keyword")?.textContent).toBe("const");
  expect(detail.querySelector("script")).toBeNull();
});
