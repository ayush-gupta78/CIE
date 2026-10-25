import { createHash } from "node:crypto";
import { posix } from "node:path";
import ts from "typescript";

export type Source = { path: string; bytes: Buffer };
export class GraphLimitError extends Error {}
export type Graph = {
  schemaVersion: 1;
  analyzerVersion: "m2-ts-1";
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
    status: "parsed" | "failed";
    sha256: string;
  }[];
  edges: {
    id: string;
    from: string;
    to: string | null;
    kind: "imports" | "reexports";
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
    JSON.stringify(ordered.map(({ path, bytes }) => [path, hash(bytes)])),
  );
  const files: Graph["files"] = [];
  const diagnostics: Graph["diagnostics"] = [...skippedDiagnostics];
  const parsed: { path: string; ast: ts.SourceFile }[] = [];
  const directories = new Set<string>();
  for (const { path, bytes } of ordered) {
    const parent = posix.dirname(path) === "." ? "." : posix.dirname(path);
    for (let dir = parent; dir !== "."; dir = posix.dirname(dir))
      directories.add(dir);
    const text = bytes.toString("utf8");
    const language = /\.tsx?$|\.mts$|\.cts$/i.test(path)
      ? "TypeScript"
      : "JavaScript";
    const kind = path.endsWith(".tsx")
      ? ts.ScriptKind.TSX
      : path.endsWith(".jsx")
        ? ts.ScriptKind.JSX
        : language === "TypeScript"
          ? ts.ScriptKind.TS
          : ts.ScriptKind.JS;
    let ast: ts.SourceFile | undefined;
    let errors: readonly ts.DiagnosticWithLocation[] = [];
    try {
      ast = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, kind);
      errors = (
        ast as ts.SourceFile & {
          parseDiagnostics: readonly ts.DiagnosticWithLocation[];
        }
      ).parseDiagnostics;
    } catch (error) {
      if (!(error instanceof RangeError)) throw error;
      diagnostics.push({ path, code: "PARSE_ERROR" });
    }
    const status = !ast || errors.length ? "failed" : "parsed";
    files.push({
      id: hash(path),
      path,
      name: posix.basename(path),
      parent,
      language,
      status,
      sha256: hash(bytes),
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
              .filter((file): file is Graph["files"][number] => !!file),
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
        sha256: source.sha256,
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
  return {
    schemaVersion: 1,
    analyzerVersion: "m2-ts-1",
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
      bytes: ordered.reduce((n, s) => n + s.bytes.length, 0),
    },
    partial: diagnostics.length > 0 || skipped > 0,
  };
}

export const isSupportedSource = (path: string) => supported.test(path);
