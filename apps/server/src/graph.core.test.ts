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

it("resolves an exact local Java class without turning platform imports into files", () => {
  const graph = buildGraph(
    [
      source(
        "src/main/java/example/Main.java",
        "import example.Helper;\nimport java.util.List;\n",
      ),
      source("src/main/java/example/Helper.java", "class Helper {}\n"),
    ],
    "repo",
    1,
    0,
  );
  expect(graph.edges).toContainEqual(
    expect.objectContaining({
      from: graph.files.find((file) => file.path.endsWith("Main.java"))!.id,
      to: graph.files.find((file) => file.path.endsWith("Helper.java"))!.id,
      kind: "imports",
      resolution: "resolved_static",
    }),
  );
  expect(graph.edges.every((edge) => edge.specifier !== "java.util.List")).toBe(
    true,
  );
});

it("does not treat commented or docstring-only references as relationships", () => {
  const graph = buildGraph(
    [
      source(
        "src/main.py",
        '"""\nfrom .helper import value\n"""\n# from .helper import value\n',
      ),
      source("src/helper.py", "value = 1\n"),
      source("src/index.html", '<!-- <img src="logo.png"> -->'),
      source("src/logo.png", "not actually an image"),
    ],
    "repo",
    1,
    0,
  );
  expect(graph.edges).toEqual([]);
});

it("extracts only active C/C++ includes with original line evidence", () => {
  const graph = buildGraph(
    [
      source(
        "native/main.cpp",
        [
          '// #include "ghost.h"',
          '/*\n#include "ghost.h"\n*/',
          'const char* text = "\\\n#include \\"ghost.h\\"";',
          "#if 0",
          '#include "ghost.h"',
          "#else",
          '# include "real.h"',
          "#endif",
        ].join("\n"),
      ),
      source("native/ghost.h", ""),
      source("native/real.h", ""),
    ],
    "repo",
    1,
    0,
  );
  expect(
    graph.edges.map(({ specifier, evidence }) => [
      specifier,
      evidence.line,
      evidence.column,
    ]),
  ).toEqual([["real.h", 10, 12]]);
  expect(graph.counts.resolved).toBe(1);
});

it("does not resolve preprocessor-ambiguous includes and reports partial coverage", () => {
  const inputs = [
    source(
      "native/main.c",
      [
        "#ifdef PLATFORM",
        '#include "target.h"',
        "#else",
        '#include "target.h"',
        "#endif",
        '#include "target.h"',
      ].join("\n"),
    ),
    source("native/target.h", ""),
  ];
  const graph = buildGraph(inputs, "repo", 1, 0);
  expect(graph.edges.map((edge) => edge.evidence.line)).toEqual([6]);
  expect(graph.diagnostics).toContainEqual({
    path: "native/main.c",
    code: "UNSUPPORTED_PREPROCESSOR_CONDITION",
    line: 1,
  });
  expect(graph.partial).toBe(true);
  expect(
    graph.files.find((file) => file.path === "native/main.c")?.status,
  ).toBe("partial");
  expect(buildGraph([...inputs].reverse(), "repo", 1, 0)).toEqual(graph);
});

it("does not promote line-spliced comments or raw strings to includes", () => {
  const graph = buildGraph(
    [
      source(
        "native/main.cpp",
        [
          "// disabled \\",
          '#include "ghost.h"',
          'auto text = R"tag(',
          '#include "ghost.h"',
          ')tag";',
          "#if 0",
          '#include "ghost.h"',
          "#elif 1",
          '#include "real.h"',
          "#endif",
        ].join("\n"),
      ),
      source("native/ghost.h", ""),
      source("native/real.h", ""),
    ],
    "repo",
    1,
    0,
  );
  expect(
    graph.edges.map(({ specifier, evidence }) => [specifier, evidence.line]),
  ).toEqual([["real.h", 9]]);
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
  expect(graph.files[0].status).toBe("partial");
  expect(graph.diagnostics).toContainEqual({
    path: "src/a.ts",
    code: "DYNAMIC_IMPORT",
    line: 1,
  });
  expect(graph.partial).toBe(true);
});

it("reports import-equals require and qualified aliases without inventing edges", () => {
  const graph = buildGraph(
    [
      source(
        "src/main.ts",
        "import dep = require('./dep');\nimport alias = Namespace.Member;\n",
      ),
      source("src/dep.ts", "export const value = 1;\n"),
    ],
    "repo",
    1,
    0,
  );
  expect(graph.files.find((file) => file.path === "src/main.ts")?.status).toBe(
    "partial",
  );
  expect(graph.edges).toEqual([]);
  expect(graph.diagnostics).toEqual([
    { path: "src/main.ts", code: "UNSUPPORTED_IMPORT_SYNTAX", line: 1 },
    { path: "src/main.ts", code: "UNSUPPORTED_IMPORT_SYNTAX", line: 2 },
  ]);
  expect(graph.partial).toBe(true);
});

it("keeps supported imports alongside unsupported import-equals with stable output", () => {
  const sources = [
    source(
      "src/main.ts",
      "import './dep';\nimport dep = require('./dep');\nexport { value } from './dep';\n",
    ),
    source("src/dep.ts", "export const value = 1;\n"),
  ];
  const graph = buildGraph(sources, "repo", 1, 0);
  expect(graph.schemaVersion).toBe(1);
  expect(graph.analyzerVersion).toBe("m3-universal-2");
  expect(graph.edges.map((edge) => edge.kind)).toEqual([
    "imports",
    "reexports",
  ]);
  expect(
    graph.edges.every((edge) => edge.resolution === "resolved_static"),
  ).toBe(true);
  expect(graph.diagnostics).toEqual([
    { path: "src/main.ts", code: "UNSUPPORTED_IMPORT_SYNTAX", line: 2 },
  ]);
  expect(graph.partial).toBe(true);
  expect(buildGraph([...sources].reverse(), "repo", 1, 0)).toEqual(graph);
});
