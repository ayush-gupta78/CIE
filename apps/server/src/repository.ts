import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { access, lstat, opendir, open, realpath } from "node:fs/promises";
import {
  basename,
  isAbsolute,
  join,
  parse,
  relative,
  resolve,
  sep,
} from "node:path";
import ignore from "ignore";
import type { FastifyInstance } from "fastify";
import {
  buildGraph,
  classify,
  GraphLimitError,
  isAnalyzedSource,
  type Graph,
  type Source,
} from "./graph.js";

type Selection = {
  root: string;
  dev: number;
  ino: number;
  repositoryId: string;
  revision: number;
  rootName: string;
};
type Rule = { base: string; matcher: ReturnType<typeof ignore> };
const generated = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".next",
  ".turbo",
  ".cache",
]);
const MAX_ENTRIES = 5000;
const MAX_IGNORE_BYTES = 256 * 1024;
const MAX_DEPTH = 32;

export class RepoError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
const invalid = () =>
  new RepoError(400, "INVALID_INPUT", "Invalid repository request.");
function fsError(error: unknown): RepoError {
  const code = (error as NodeJS.ErrnoException)?.code;
  if (code === "ENOENT" || code === "ENOTDIR")
    return new RepoError(404, "NOT_FOUND", "Directory not found.");
  if (code === "EACCES" || code === "EPERM" || code === "ELOOP")
    return new RepoError(403, "FORBIDDEN_PATH", "Directory is not accessible.");
  return new RepoError(503, "UNAVAILABLE", "Local directory is unavailable.");
}
function contained(root: string, candidate: string) {
  const rest = relative(root, candidate);
  return (
    rest === "" ||
    (rest !== ".." && !rest.startsWith(`..${sep}`) && !isAbsolute(rest))
  );
}
function parts(dir: unknown): string[] {
  if (dir === ".") return [];
  if (
    typeof dir !== "string" ||
    !dir ||
    dir.length > 1024 ||
    dir.startsWith("/") ||
    /[\\%\0]/.test(dir) ||
    /^[A-Za-z]:/.test(dir)
  )
    throw invalid();
  const segments = dir.split("/");
  if (
    segments.length > MAX_DEPTH ||
    segments.some((s) => !s || s === "." || s === "..")
  )
    throw invalid();
  return segments;
}
function hidden(name: string) {
  return (
    generated.has(name) || (name.startsWith(".env") && name !== ".env.example")
  );
}
function ignored(segments: string[], directory: boolean, rules: Rule[]) {
  if (segments.some(hidden)) return true;
  const name = segments.join("/");
  let result = false;
  for (const rule of rules) {
    const rel = rule.base ? name.slice(rule.base.length + 1) : name;
    if (!rel) continue;
    const match = rule.matcher.test(rel + (directory ? "/" : ""));
    if (match.ignored) result = true;
    if (match.unignored) result = false;
  }
  return result;
}
async function rulesAt(root: string, segments: string[]): Promise<Rule | null> {
  const file = join(root, ...segments, ".gitignore");
  let info;
  try {
    info = await lstat(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw fsError(error);
  }
  if (info.isSymbolicLink() || !info.isFile()) return null;
  if (info.size > MAX_IGNORE_BYTES)
    throw new RepoError(
      422,
      "IGNORE_TOO_LARGE",
      "An ignore file exceeds the supported size.",
    );
  let handle;
  try {
    handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const buffer = Buffer.alloc(MAX_IGNORE_BYTES + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await handle.read(
        buffer,
        length,
        buffer.length - length,
        length,
      );
      if (!bytesRead) break;
      length += bytesRead;
    }
    if (length > MAX_IGNORE_BYTES)
      throw new RepoError(
        422,
        "IGNORE_TOO_LARGE",
        "An ignore file exceeds the supported size.",
      );
    return {
      base: segments.join("/"),
      matcher: ignore().add(buffer.subarray(0, length).toString("utf8")),
    };
  } catch (error) {
    if (error instanceof RepoError) throw error;
    throw fsError(error);
  } finally {
    await handle?.close();
  }
}
async function checkedDirectory(selection: Selection, segments: string[]) {
  const rules: Rule[] = [];
  const baseRule = await rulesAt(selection.root, []);
  if (baseRule) rules.push(baseRule);
  let current = selection.root;
  for (let i = 0; i < segments.length; i++) {
    if (ignored(segments.slice(0, i + 1), true, rules))
      throw new RepoError(403, "FORBIDDEN_PATH", "Directory is excluded.");
    current = resolve(current, segments[i]);
    if (!contained(selection.root, current))
      throw new RepoError(
        403,
        "FORBIDDEN_PATH",
        "Directory is outside the selected repository.",
      );
    try {
      const info = await lstat(current);
      if (info.isSymbolicLink() || !info.isDirectory())
        throw new RepoError(
          403,
          "FORBIDDEN_PATH",
          "Directory is not available for browsing.",
        );
      const canonical = await realpath(current);
      if (!contained(selection.root, canonical))
        throw new RepoError(
          403,
          "FORBIDDEN_PATH",
          "Directory is outside the selected repository.",
        );
    } catch (error) {
      throw error instanceof RepoError ? error : fsError(error);
    }
    const rule = await rulesAt(selection.root, segments.slice(0, i + 1));
    if (rule) rules.push(rule);
  }
  return { current, rules };
}
function publicSelection(selection: Selection) {
  return {
    selected: true as const,
    repositoryId: selection.repositoryId,
    revision: selection.revision,
    rootName: selection.rootName,
  };
}
function cursorData(raw: unknown, selection: Selection, dir: string): number {
  if (raw === undefined) return 0;
  if (
    typeof raw !== "string" ||
    raw.length > 512 ||
    !/^[A-Za-z0-9_-]+$/.test(raw)
  )
    throw invalid();
  try {
    const value: unknown = JSON.parse(
      Buffer.from(raw, "base64url").toString("utf8"),
    );
    if (
      !value ||
      typeof value !== "object" ||
      !("id" in value) ||
      !("rev" in value) ||
      !("dir" in value) ||
      !("offset" in value)
    )
      throw invalid();
    if (
      value.id !== selection.repositoryId ||
      value.rev !== selection.revision ||
      value.dir !== dir
    )
      throw new RepoError(
        409,
        "STALE_REPOSITORY",
        "Repository view changed. Refresh the directory.",
      );
    if (
      !Number.isSafeInteger(value.offset) ||
      (value.offset as number) < 1 ||
      (value.offset as number) > MAX_ENTRIES
    )
      throw invalid();
    return value.offset as number;
  } catch (error) {
    throw error instanceof RepoError ? error : invalid();
  }
}

export function registerRepositoryRoutes(app: FastifyInstance) {
  let selection: Selection | null = null;
  let graph: Graph | null = null;
  let analyzing = false;
  let revision = 0;
  let mutation = 0;
  let scans = 0;
  const requireSelection = (): Selection => {
    if (!selection)
      throw new RepoError(
        409,
        "NO_REPOSITORY_SELECTED",
        "Open a repository first.",
      );
    return selection;
  };
  const checkRoot = async (selected: Selection) => {
    try {
      const info = await lstat(selected.root);
      if (
        !info.isDirectory() ||
        info.isSymbolicLink() ||
        info.dev !== selected.dev ||
        info.ino !== selected.ino
      )
        throw new RepoError(
          403,
          "FORBIDDEN_PATH",
          "Selected directory has changed. Choose it again.",
        );
    } catch (error) {
      throw error instanceof RepoError ? error : fsError(error);
    }
  };

  app.get("/api/v1/repository", async () =>
    selection ? publicSelection(selection) : { selected: false },
  );
  app.post("/api/v1/repository/select", async (request) => {
    const body = request.body;
    if (
      !body ||
      typeof body !== "object" ||
      !("path" in body) ||
      typeof body.path !== "string" ||
      !body.path ||
      body.path.length > 4096 ||
      body.path.includes("\0") ||
      !isAbsolute(body.path)
    )
      throw invalid();
    const ticket = ++mutation;
    try {
      const source = resolve(body.path);
      if (source === parse(source).root) throw invalid();
      const info = await lstat(source);
      if (info.isSymbolicLink() || !info.isDirectory())
        throw new RepoError(
          403,
          "FORBIDDEN_PATH",
          "Choose a regular directory, not a file or symlink.",
        );
      await access(source, constants.R_OK | constants.X_OK);
      const root = await realpath(source);
      const canonicalInfo = await lstat(root);
      if (!canonicalInfo.isDirectory() || canonicalInfo.isSymbolicLink())
        throw new RepoError(
          403,
          "FORBIDDEN_PATH",
          "Directory is not accessible.",
        );
      if (ticket !== mutation)
        throw new RepoError(
          409,
          "STALE_REPOSITORY",
          "Repository selection changed. Try again.",
        );
      selection = {
        root,
        dev: canonicalInfo.dev,
        ino: canonicalInfo.ino,
        repositoryId: randomUUID(),
        revision: ++revision,
        rootName: basename(root),
      };
      graph = null;
      return publicSelection(selection);
    } catch (error) {
      throw error instanceof RepoError ? error : fsError(error);
    }
  });
  app.delete("/api/v1/repository", async () => {
    mutation++;
    revision++;
    selection = null;
    graph = null;
    return { selected: false };
  });
  app.post("/api/v1/repository/rescan", async () => {
    const selected = requireSelection();
    await checkRoot(selected);
    if (selection !== selected)
      throw new RepoError(
        409,
        "STALE_REPOSITORY",
        "Repository selection changed. Try again.",
      );
    mutation++;
    selection = { ...selected, revision: ++revision };
    graph = null;
    return publicSelection(selection);
  });
  app.post("/api/v1/repository/analyze", async (request) => {
    const selected = requireSelection();
    const body = request.body;
    if (
      !body ||
      typeof body !== "object" ||
      Array.isArray(body) ||
      Object.keys(body).length !== 2 ||
      !("repositoryId" in body) ||
      !("revision" in body) ||
      typeof body.repositoryId !== "string" ||
      !Number.isSafeInteger(body.revision)
    )
      throw invalid();
    if (
      body.repositoryId !== selected.repositoryId ||
      body.revision !== selected.revision
    )
      throw new RepoError(
        409,
        "STALE_REPOSITORY",
        "Repository view changed. Refresh it.",
      );
    if (analyzing)
      throw new RepoError(
        503,
        "UNAVAILABLE",
        "Analysis is busy. Retry shortly.",
      );
    analyzing = true;
    try {
      await checkRoot(selected);
      const started = Date.now();
      const sources: Source[] = [];
      const skippedDiagnostics: Graph["diagnostics"] = [];
      let skipped = 0;
      let bytes = 0;
      let directories = 0;
      const stack: string[][] = [[]];
      while (stack.length) {
        if (++directories > 1000)
          throw new RepoError(
            422,
            "ANALYSIS_LIMIT",
            "Directory limit exceeded.",
          );
        if (Date.now() - started > 10000)
          throw new RepoError(
            422,
            "ANALYSIS_LIMIT",
            "Analysis time limit exceeded.",
          );
        const segments = stack.pop()!;
        const { current, rules } = await checkedDirectory(selected, segments);
        const entries: { name: string; kind: "directory" | "file" }[] = [];
        let scanned = 0;
        try {
          for await (const entry of await opendir(current)) {
            if (++scanned > MAX_ENTRIES)
              throw new RepoError(
                422,
                "DIRECTORY_TOO_LARGE",
                "Directory exceeds the supported entry limit.",
              );
            if (
              entry.isSymbolicLink() ||
              (!entry.isDirectory() && !entry.isFile())
            )
              continue;
            if (ignored([...segments, entry.name], entry.isDirectory(), rules))
              continue;
            entries.push({
              name: entry.name,
              kind: entry.isDirectory() ? "directory" : "file",
            });
          }
        } catch (error) {
          throw error instanceof RepoError ? error : fsError(error);
        }
        entries.sort((a, b) =>
          a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
        );
        for (const entry of entries) {
          const next = [...segments, entry.name];
          const path = next.join("/");
          if (
            path.length > 1024 ||
            /[\\%\0]/.test(entry.name) ||
            next.length > MAX_DEPTH
          )
            throw new RepoError(
              422,
              "ANALYSIS_LIMIT",
              "A file path exceeds the supported graph path contract.",
            );
          if (entry.kind === "directory") {
            stack.push(next);
            continue;
          }
          if (sources.length >= 200)
            throw new RepoError(
              422,
              "ANALYSIS_LIMIT",
              "File limit exceeded; no partial graph was published.",
            );
          const candidate = resolve(current, entry.name);
          let handle;
          try {
            const before = await lstat(candidate);
            if (
              !before.isFile() ||
              before.isSymbolicLink() ||
              !contained(selected.root, await realpath(candidate))
            )
              continue;
            const metadata = {
              path,
              sizeBytes: before.size,
              mtimeMs: before.mtimeMs,
            };
            if (!isAnalyzedSource(path)) {
              sources.push({
                ...metadata,
                contentKind: classify(path).contentKind,
              });
              continue;
            }
            if (
              before.size > 1024 * 1024 ||
              bytes + before.size > 8 * 1024 * 1024
            ) {
              if (!/\.(?:[cm]?[jt]s|jsx|tsx)$/i.test(path)) {
                sources.push({
                  ...metadata,
                  analysisSkipped: true,
                  contentKind: classify(path).contentKind,
                });
                skippedDiagnostics.push({ path, code: "ANALYSIS_SIZE_LIMIT" });
                skipped++;
                continue;
              }
              throw new RepoError(
                422,
                "ANALYSIS_LIMIT",
                "Source byte limit exceeded.",
              );
            }
            handle = await open(
              candidate,
              constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
            );
            const opened = await handle.stat();
            if (
              !opened.isFile() ||
              opened.dev !== before.dev ||
              opened.ino !== before.ino
            )
              throw new RepoError(
                403,
                "FORBIDDEN_PATH",
                "Source file changed during capture.",
              );
            const buffer = Buffer.alloc(1024 * 1024 + 1);
            let length = 0;
            while (length < buffer.length) {
              const { bytesRead } = await handle.read(
                buffer,
                length,
                buffer.length - length,
                length,
              );
              if (!bytesRead) break;
              length += bytesRead;
            }
            const after = await handle.stat();
            if (length > 1024 * 1024 || bytes + length > 8 * 1024 * 1024)
              throw new RepoError(
                422,
                "ANALYSIS_LIMIT",
                "Source byte limit exceeded.",
              );
            if (
              opened.size !== after.size ||
              opened.mtimeMs !== after.mtimeMs ||
              length !== after.size
            )
              throw new RepoError(
                409,
                "STALE_REPOSITORY",
                "Source changed during capture. Retry analysis.",
              );
            const captured = buffer.subarray(0, length);
            let validText = !captured.includes(0);
            if (validText) {
              try {
                new TextDecoder("utf-8", { fatal: true }).decode(captured);
              } catch {
                validText = false;
              }
            }
            if (!validText) {
              skipped++;
              skippedDiagnostics.push({ path, code: "UNSUPPORTED_ENCODING" });
              sources.push({
                ...metadata,
                analysisSkipped: true,
                contentKind: "binary",
              });
              continue;
            }
            sources.push({ ...metadata, bytes: captured, contentKind: "text" });
            bytes += length;
          } catch (error) {
            throw error instanceof RepoError ? error : fsError(error);
          } finally {
            await handle?.close();
          }
        }
      }
      await checkRoot(selected);
      if (selection !== selected)
        throw new RepoError(
          409,
          "STALE_REPOSITORY",
          "Repository view changed. Retry analysis.",
        );
      let result: Graph;
      try {
        result = buildGraph(
          sources,
          selected.repositoryId,
          selected.revision,
          skipped,
          skippedDiagnostics,
        );
      } catch (error) {
        if (error instanceof GraphLimitError)
          throw new RepoError(
            422,
            "ANALYSIS_LIMIT",
            "Dependency limit exceeded.",
          );
        throw error;
      }
      if (Date.now() - started > 10000)
        throw new RepoError(
          422,
          "ANALYSIS_LIMIT",
          "Analysis time limit exceeded.",
        );
      if (result.edges.length > 1000)
        throw new RepoError(
          422,
          "ANALYSIS_LIMIT",
          "Dependency limit exceeded.",
        );
      if (selection !== selected)
        throw new RepoError(
          409,
          "STALE_REPOSITORY",
          "Repository view changed. Retry analysis.",
        );
      graph = result;
      return result;
    } finally {
      analyzing = false;
    }
  });
  app.get("/api/v1/repository/graph", async () => {
    requireSelection();
    if (
      !graph ||
      graph.repositoryId !== selection?.repositoryId ||
      graph.revision !== selection.revision
    )
      throw new RepoError(
        409,
        "NO_GRAPH",
        "Analyze the selected repository first.",
      );
    return graph;
  });
  app.get("/api/v1/repository/tree", async (request) => {
    const selected = requireSelection();
    const query = request.query;
    if (
      !query ||
      typeof query !== "object" ||
      !("dir" in query) ||
      !("repositoryId" in query) ||
      !("revision" in query)
    )
      throw invalid();
    if (
      query.repositoryId !== selected.repositoryId ||
      Number(query.revision) !== selected.revision
    )
      throw new RepoError(
        409,
        "STALE_REPOSITORY",
        "Repository view changed. Refresh the directory.",
      );
    const segments = parts(query.dir);
    const dir = segments.join("/") || ".";
    const limit = "limit" in query ? Number(query.limit) : 100;
    if (
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 200 ||
      ("limit" in query && !/^[1-9]\d*$/.test(String(query.limit)))
    )
      throw invalid();
    const offset = cursorData(
      "cursor" in query ? query.cursor : undefined,
      selected,
      dir,
    );
    if (scans >= 2)
      throw new RepoError(
        503,
        "UNAVAILABLE",
        "Directory browser is busy. Retry shortly.",
      );
    scans++;
    try {
      await checkRoot(selected);
      const { current, rules } = await checkedDirectory(selected, segments);
      const found: { name: string; kind: "directory" | "file" }[] = [];
      try {
        const directory = await opendir(current);
        let scanned = 0;
        for await (const entry of directory) {
          if (++scanned > MAX_ENTRIES)
            throw new RepoError(
              422,
              "DIRECTORY_TOO_LARGE",
              "Directory exceeds the supported entry limit.",
            );
          if (
            entry.isSymbolicLink() ||
            (!entry.isDirectory() && !entry.isFile())
          )
            continue;
          if (ignored([...segments, entry.name], entry.isDirectory(), rules))
            continue;
          found.push({
            name: entry.name,
            kind: entry.isDirectory() ? "directory" : "file",
          });
        }
      } catch (error) {
        throw error instanceof RepoError ? error : fsError(error);
      }
      found.sort(
        (a, b) =>
          Number(b.kind === "directory") - Number(a.kind === "directory") ||
          a.name.toLowerCase().localeCompare(b.name.toLowerCase(), "en") ||
          (a.name < b.name ? -1 : a.name > b.name ? 1 : 0),
      );
      if (offset > found.length)
        throw new RepoError(
          409,
          "STALE_REPOSITORY",
          "Directory changed. Refresh it.",
        );
      const entries = [];
      for (const item of found.slice(offset, offset + limit)) {
        const candidate = resolve(current, item.name);
        if (!contained(selected.root, candidate)) continue;
        try {
          const info = await lstat(candidate);
          if (
            info.isSymbolicLink() ||
            (item.kind === "directory" ? !info.isDirectory() : !info.isFile())
          )
            continue;
          if (!contained(selected.root, await realpath(candidate))) continue;
          const path = [...segments, item.name].join("/");
          const languageHint =
            item.kind === "file"
              ? (
                  {
                    ts: "TypeScript",
                    tsx: "TypeScript",
                    js: "JavaScript",
                    jsx: "JavaScript",
                    py: "Python",
                    md: "Markdown",
                    json: "JSON",
                    css: "CSS",
                    html: "HTML",
                  } as Record<string, string>
                )[item.name.split(".").at(-1)!.toLowerCase()]
              : undefined;
          entries.push({
            name: item.name,
            path,
            kind: item.kind,
            ...(item.kind === "file" ? { sizeBytes: info.size } : {}),
            modifiedAt: info.mtime.toISOString(),
            ...(languageHint ? { languageHint } : {}),
          });
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
          throw error instanceof RepoError ? error : fsError(error);
        }
      }
      await checkRoot(selected);
      if (selection !== selected)
        throw new RepoError(
          409,
          "STALE_REPOSITORY",
          "Repository selection changed. Refresh it.",
        );
      const next =
        offset + limit < found.length
          ? Buffer.from(
              JSON.stringify({
                id: selected.repositoryId,
                rev: selected.revision,
                dir,
                offset: offset + limit,
              }),
            ).toString("base64url")
          : null;
      return {
        repositoryId: selected.repositoryId,
        revision: selected.revision,
        dir,
        entries,
        nextCursor: next,
      };
    } finally {
      scans--;
    }
  });
}
