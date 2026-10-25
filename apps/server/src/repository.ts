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
      return publicSelection(selection);
    } catch (error) {
      throw error instanceof RepoError ? error : fsError(error);
    }
  });
  app.delete("/api/v1/repository", async () => {
    mutation++;
    revision++;
    selection = null;
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
    return publicSelection(selection);
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
