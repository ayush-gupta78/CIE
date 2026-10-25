import { expect, it } from "vitest";
import { buildGraph } from "./graph.js";

const source = (path: string, text: string) => ({
  path,
  bytes: Buffer.from(text),
});

it("keeps cycles, disconnected nodes, index modules and ambiguous targets honest", () => {
  const graph = buildGraph(
    [
      source(
        "odd/a.ts",
        "import './b';\nimport './folder';\nimport './multi';\n",
      ),
      source("odd/b.ts", "import './a';\n"),
      source("odd/folder/index.ts", "export const x = 1;\n"),
      source("odd/multi.ts", "export {};\n"),
      source("odd/multi.js", "export {};\n"),
      source("odd/isolated.ts", "export {};\n"),
    ],
    "repo",
    1,
    0,
  );
  expect(graph.files).toHaveLength(6);
  expect(graph.directories).toEqual(["odd", "odd/folder"]);
  const a = graph.files.find((f) => f.path === "odd/a.ts")!;
  const b = graph.files.find((f) => f.path === "odd/b.ts")!;
  expect(graph.edges).toContainEqual(
    expect.objectContaining({
      from: a.id,
      to: b.id,
      resolution: "resolved_static",
    }),
  );
  expect(graph.edges).toContainEqual(
    expect.objectContaining({
      from: b.id,
      to: a.id,
      resolution: "resolved_static",
    }),
  );
  expect(graph.edges).toContainEqual(
    expect.objectContaining({
      from: a.id,
      to: graph.files.find((f) => f.path === "odd/folder/index.ts")!.id,
    }),
  );
  expect(graph.edges).toContainEqual(
    expect.objectContaining({
      from: a.id,
      to: null,
      specifier: "./multi",
      resolution: "unresolved",
    }),
  );
  expect(graph.diagnostics).toContainEqual({
    path: "odd/a.ts",
    code: "AMBIGUOUS_IMPORT",
    line: 3,
  });
});

it("resolves a TypeScript source imported with its emitted .js specifier", () => {
  const graph = buildGraph(
    [
      source("src/main.ts", "import './helper.js';\n"),
      source("src/helper.ts", "export {};\n"),
    ],
    "repo",
    1,
    0,
  );
  expect(graph.edges).toContainEqual(
    expect.objectContaining({
      to: graph.files.find((file) => file.path === "src/helper.ts")!.id,
      resolution: "resolved_static",
    }),
  );
});

it("keeps valid siblings when pathological nesting defeats the AST parser", () => {
  const graph = buildGraph(
    [
      source("src/deep.ts", "(".repeat(1000) + "x" + ")".repeat(1000)),
      source("src/good.ts", "import './other';\n"),
      source("src/other.ts", "export {};\n"),
    ],
    "repo",
    1,
    0,
  );
  expect(graph.files.find((file) => file.path === "src/deep.ts")?.status).toBe(
    "failed",
  );
  expect(graph.diagnostics).toContainEqual({
    path: "src/deep.ts",
    code: "PARSE_ERROR",
  });
  expect(graph.counts.resolved).toBe(1);
  expect(graph.partial).toBe(true);
});

it("rejects excessive imports before constructing an unbounded edge list", () => {
  expect(() =>
    buildGraph(
      [
        source(
          "src/a.ts",
          Array.from(
            { length: 1001 },
            (_, i) => `import './missing${i}';`,
          ).join("\n"),
        ),
      ],
      "repo",
      1,
      0,
    ),
  ).toThrow(/dependency limit/i);
});

it("marks dynamic-only connectivity as partial", () => {
  const graph = buildGraph(
    [source("src/a.ts", "const x = import('./other');")],
    "repo",
    1,
    0,
  );
  expect(graph.edges).toHaveLength(0);
  expect(graph.diagnostics).toContainEqual({
    path: "src/a.ts",
    code: "DYNAMIC_IMPORT",
    line: 1,
  });
  expect(graph.partial).toBe(true);
});
