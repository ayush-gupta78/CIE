import { createHash } from "node:crypto";
import { posix } from "node:path";
import ts from "typescript";
import { extractReferences } from "./relationshipAdapters.js";

export type Source = {
  path: string;
  bytes?: Buffer;
  sizeBytes?: number;
  mtimeMs?: number;
  contentKind?: "text" | "binary" | "unknown";
  analysisSkipped?: boolean;
};
export class GraphLimitError extends Error {}
export type Graph = {
  schemaVersion: 1;
  analyzerVersion: string;
  manifest: string;
  repositoryId: string;
  revision: number;
  directories: string[];
  files: {
    id: string;
    path: string;
    name: string;
    parent: string;
    language: string;
    category: string;
    contentKind: "text" | "binary" | "unknown";
    sizeBytes: number;
    incomingCount: number;
    outgoingCount: number;
    status: "parsed" | "partial" | "failed" | "unsupported" | "skipped";
    sha256?: string;
  }[];
  edges: {
    id: string;
    from: string;
    to: string | null;
    kind: "imports" | "reexports" | "includes" | "asset" | "config";
    resolution: "resolved_static" | "unresolved" | "external";
    specifier: string;
    evidence: {
      path: string;
      line: number;
      column: number;
      rule: string;
      sha256: string;
    };
  }[];
  diagnostics: { path: string; code: string; line?: number }[];
  counts: {
    files: number;
    resolved: number;
    unresolved: number;
    skipped: number;
    bytes: number;
  };
  partial: boolean;
};
const hash = (data: string | Buffer) =>
  createHash("sha256").update(data).digest("hex");
const supported = /\.(?:[cm]?[jt]s|jsx|tsx)$/i;
const extensions = [
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
];

// This is a classification map, never an inclusion allowlist.
const categories: Record<string, [string, string]> = {};
for (const [category, language, list] of [
  ["source", "Python", "py pyi"],
  ["source", "Java", "java"],
  ["source", "Kotlin", "kt kts"],
  ["source", "Scala", "scala"],
  ["source", "C/C++", "c h cpp hpp cc"],
  ["source", "Rust", "rs"],
  ["source", "Go", "go"],
  ["source", "Swift", "swift"],
  ["source", "Zig", "zig"],
  ["source", "C#", "cs"],
  ["source", "PHP", "php"],
  ["source", "Ruby", "rb"],
  ["source", "Lua", "lua"],
  ["source", "Dart", "dart"],
  ["source", "Elixir", "ex exs"],
  ["source", "Haskell", "hs"],
  ["source", "Shell", "sh ps1"],
  ["web", "HTML", "html htm"],
  ["web", "CSS", "css scss sass less"],
  ["web", "Vue/Svelte", "vue svelte"],
  ["data", "Data", "json jsonc yaml yml toml xml csv tsv"],
  ["documentation", "Documentation", "md mdx txt rst adoc pdf ipynb"],
  ["database", "Schema", "sql prisma graphql proto"],
  ["configuration", "Configuration", "ini cfg tf tfvars"],
  ["image", "Image", "png jpg jpeg svg webp gif ico"],
  ["font", "Font", "woff woff2 ttf otf"],
  ["media", "Media", "mp3 wav mp4 webm"],
  ["binary", "Binary", "bin zip tar gz wasm exe dll so a o class jar"],
] as [string, string, string][]) {
  for (const ext of list.split(" ")) categories[ext] = [category, language];
}
const binaryCategories = new Set(["image", "font", "media", "binary"]);
export function classify(path: string): {
  category: string;
  language: string;
  contentKind: "text" | "binary" | "unknown";
} {
  const name = posix.basename(path).toLowerCase();
  if (supported.test(path))
    return {
      category: "source",
      language: /\.tsx?$|\.mts$|\.cts$/i.test(path)
        ? "TypeScript"
        : "JavaScript",
      contentKind: "text",
    };
  if (
    [
      "dockerfile",
      "makefile",
      ".gitignore",
      ".editorconfig",
      ".env.example",
    ].includes(name)
  )
    return {
      category: "configuration",
      language: "Configuration",
      contentKind: "text",
    };
  const ext = name.includes(".") ? name.split(".").at(-1)! : "";
  const [category, language] = categories[ext] ?? ["unknown", "Unknown"];
  return {
    category,
    language,
    contentKind:
      (binaryCategories.has(category) && ext !== "svg") || ext === "pdf"
        ? "binary"
        : category === "unknown"
          ? "unknown"
          : "text",
  };
}
export const isAnalyzedSource = (path: string) =>
  supported.test(path) ||
  /\.(?:py|pyi|c|h|cpp|hpp|cc|rs|java|html?|css)$/i.test(path);

export function buildGraph(
  sources: Source[],
  repositoryId: string,
  revision: number,
  skipped: number,
  skippedDiagnostics: Graph["diagnostics"] = [],
): Graph {
  const ordered = [...sources].sort((a, b) =>
    a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
  );
  const manifest = hash(
    JSON.stringify(
      ordered.map(({ path, bytes, sizeBytes, mtimeMs }) => [
        path,
        sizeBytes ?? bytes?.length ?? 0,
        bytes ? hash(bytes) : (mtimeMs ?? 0),
      ]),
    ),
  );
  const files: Graph["files"] = [];
  const diagnostics: Graph["diagnostics"] = [...skippedDiagnostics];
  const parsed: { path: string; ast: ts.SourceFile }[] = [];
  const directories = new Set<string>();
  for (const item of ordered) {
    const { path, bytes } = item;
    const parent = posix.dirname(path) === "." ? "." : posix.dirname(path);
    for (let dir = parent; dir !== "."; dir = posix.dirname(dir))
      directories.add(dir);
    const { language, category, contentKind: inferredKind } = classify(path);
    const contentKind = item.contentKind ?? inferredKind;
    const kind = path.endsWith(".tsx")
      ? ts.ScriptKind.TSX
      : path.endsWith(".jsx")
        ? ts.ScriptKind.JSX
        : language === "TypeScript"
          ? ts.ScriptKind.TS
          : ts.ScriptKind.JS;
    let ast: ts.SourceFile | undefined;
    let errors: readonly ts.DiagnosticWithLocation[] = [];
    if (bytes && supported.test(path) && contentKind === "text") {
      try {
        ast = ts.createSourceFile(
          path,
          bytes.toString("utf8"),
          ts.ScriptTarget.Latest,
          true,
          kind,
        );
        errors = (
          ast as ts.SourceFile & {
            parseDiagnostics: readonly ts.DiagnosticWithLocation[];
          }
        ).parseDiagnostics;
      } catch (error) {
        if (!(error instanceof RangeError)) throw error;
        diagnostics.push({ path, code: "PARSE_ERROR" });
      }
    }
    const status = item.analysisSkipped
      ? "skipped"
      : supported.test(path)
        ? !ast || errors.length
          ? "failed"
          : "parsed"
        : bytes && isAnalyzedSource(path)
          ? "partial"
          : "unsupported";
    files.push({
      id: hash(path),
      path,
      name: posix.basename(path),
      parent,
      language,
      category,
      contentKind,
      sizeBytes: item.sizeBytes ?? bytes?.length ?? 0,
      incomingCount: 0,
      outgoingCount: 0,
      status,
      ...(bytes ? { sha256: hash(bytes) } : {}),
    });
    if (status === "parsed" && ast) parsed.push({ path, ast });
    for (const error of errors)
      diagnostics.push({
        path,
        code: "PARSE_ERROR",
        line: ast!.getLineAndCharacterOfPosition(error.start ?? 0).line + 1,
      });
  }
  const byPath = new Map(files.map((file) => [file.path, file]));
  const edges: Graph["edges"] = [];
  for (const { path, ast } of parsed) {
    const source = byPath.get(path)!;
    const stack: ts.Node[] = [ast];
    while (stack.length) {
      const node = stack.pop()!;
      if (
        ts.isCallExpression(node) &&
        (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
          (ts.isIdentifier(node.expression) &&
            node.expression.text === "require"))
      ) {
        const location = ast.getLineAndCharacterOfPosition(node.getStart(ast));
        diagnostics.push({
          path,
          code: "DYNAMIC_IMPORT",
          line: location.line + 1,
        });
      }
      ts.forEachChild(node, (child) => {
        stack.push(child);
      });
    }
    for (const statement of ast.statements) {
      if (ts.isImportEqualsDeclaration(statement)) {
        diagnostics.push({
          path,
          code: "UNSUPPORTED_IMPORT_SYNTAX",
          line:
            ast.getLineAndCharacterOfPosition(statement.getStart(ast)).line + 1,
        });
        continue;
      }
      if (
        !ts.isImportDeclaration(statement) &&
        !ts.isExportDeclaration(statement)
      )
        continue;
      const module = statement.moduleSpecifier;
      if (!module || !ts.isStringLiteral(module)) continue;
      if (edges.length >= 1000)
        throw new GraphLimitError("Dependency limit exceeded.");
      const specifier = module.text;
      const kind = ts.isImportDeclaration(statement) ? "imports" : "reexports";
      const location = ast.getLineAndCharacterOfPosition(
        statement.getStart(ast),
      );
      let resolution: Graph["edges"][number]["resolution"] = "external";
      let target: Graph["files"][number] | undefined;
      if (specifier.startsWith(".")) {
        const candidate = posix.normalize(
          posix.join(posix.dirname(path), specifier),
        );
        const rootSafe =
          candidate !== ".." &&
          !candidate.startsWith("../") &&
          !candidate.startsWith("/");
        const options = rootSafe
          ? [
              candidate,
              ...(/\.js$/.test(candidate)
                ? [
                    candidate.replace(/\.js$/, ".ts"),
                    candidate.replace(/\.js$/, ".tsx"),
                  ]
                : /\.mjs$/.test(candidate)
                  ? [candidate.replace(/\.mjs$/, ".mts")]
                  : /\.cjs$/.test(candidate)
                    ? [candidate.replace(/\.cjs$/, ".cts")]
                    : []),
              ...extensions.map((ext) => candidate + ext),
              ...extensions.map((ext) => posix.join(candidate, "index" + ext)),
            ]
          : [];
        const matches = [
          ...new Set(
            options
              .map((option) => byPath.get(option))
              .filter(
                (file): file is Graph["files"][number] =>
                  !!file && supported.test(file.path),
              ),
          ),
        ];
        // ponytail: ambiguous extension matches remain unresolved; add tsconfig-aware resolution only when a concrete project needs it.
        if (matches.length === 1) target = matches[0];
        resolution = target ? "resolved_static" : "unresolved";
        if (!target)
          diagnostics.push({
            path,
            code: matches.length > 1 ? "AMBIGUOUS_IMPORT" : "UNRESOLVED_IMPORT",
            line: location.line + 1,
          });
      }
      const evidence = {
        path,
        line: location.line + 1,
        column: location.character + 1,
        rule: target
          ? "unique-relative-file"
          : specifier.startsWith(".")
            ? "unresolved-relative"
            : "bare-specifier",
        sha256: source.sha256!,
      };
      const from = source.id;
      const to = target?.id ?? null;
      edges.push({
        id: hash(
          JSON.stringify([
            from,
            kind,
            location.line,
            location.character,
            specifier,
            to,
          ]),
        ),
        from,
        to,
        kind,
        resolution,
        specifier,
        evidence,
      });
    }
  }
  for (const { path, bytes } of ordered) {
    if (!bytes || supported.test(path)) continue;
    const source = byPath.get(path)!;
    if (source.status !== "partial") continue;
    for (const ref of extractReferences(path, bytes.toString("utf8"))) {
      if (ref.diagnostic) {
        diagnostics.push({ path, code: ref.diagnostic, line: ref.line });
        continue;
      }
      if (!ref.candidates.length) continue;
      const matches = [
        ...new Set(
          ref.candidates
            .map((candidate) => byPath.get(candidate))
            .filter((file): file is Graph["files"][number] => !!file),
        ),
      ];
      if (matches.length !== 1) {
        diagnostics.push({
          path,
          code: matches.length ? "AMBIGUOUS_REFERENCE" : "UNRESOLVED_REFERENCE",
          line: ref.line,
        });
        continue;
      }
      if (edges.length >= 1000)
        throw new GraphLimitError("Dependency limit exceeded.");
      const target = matches[0];
      edges.push({
        id: hash(
          JSON.stringify([
            source.id,
            ref.kind,
            ref.line,
            ref.column,
            ref.specifier,
            target.id,
          ]),
        ),
        from: source.id,
        to: target.id,
        kind: ref.kind,
        resolution: "resolved_static",
        specifier: ref.specifier,
        evidence: {
          path,
          line: ref.line,
          column: ref.column,
          rule: "unique-local-file",
          sha256: source.sha256!,
        },
      });
    }
  }
  edges.sort(
    (a, b) =>
      a.evidence.path.localeCompare(b.evidence.path, "en") ||
      a.evidence.line - b.evidence.line ||
      a.evidence.column - b.evidence.column ||
      a.id.localeCompare(b.id, "en"),
  );
  diagnostics.sort(
    (a, b) =>
      a.path.localeCompare(b.path, "en") ||
      (a.line ?? 0) - (b.line ?? 0) ||
      a.code.localeCompare(b.code, "en"),
  );
  const incomplete = new Set(
    diagnostics
      .filter((diagnostic) =>
        [
          "DYNAMIC_IMPORT",
          "UNSUPPORTED_IMPORT_SYNTAX",
          "UNRESOLVED_IMPORT",
          "AMBIGUOUS_IMPORT",
          "UNRESOLVED_REFERENCE",
          "AMBIGUOUS_REFERENCE",
        ].includes(diagnostic.code),
      )
      .map((diagnostic) => diagnostic.path),
  );
  for (const file of files)
    if (file.status === "parsed" && incomplete.has(file.path))
      file.status = "partial";
  const byId = new Map(files.map((file) => [file.id, file]));
  for (const edge of edges) {
    if (edge.resolution !== "resolved_static" || !edge.to) continue;
    byId.get(edge.from)!.outgoingCount++;
    byId.get(edge.to)!.incomingCount++;
  }
  return {
    schemaVersion: 1,
    analyzerVersion: "m3-universal-2",
    manifest,
    repositoryId,
    revision,
    directories: [...directories].sort(),
    files,
    edges,
    diagnostics,
    counts: {
      files: files.length,
      resolved: edges.filter((e) => e.resolution === "resolved_static").length,
      unresolved: edges.filter((e) => e.resolution === "unresolved").length,
      skipped,
      bytes: ordered.reduce((n, s) => n + (s.bytes?.length ?? 0), 0),
    },
    partial:
      diagnostics.length > 0 ||
      skipped > 0 ||
      files.some((file) => file.status !== "parsed"),
  };
}

export const isSupportedSource = (path: string) => supported.test(path);
