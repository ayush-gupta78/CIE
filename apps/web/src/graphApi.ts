import { ApiError, json, request, type Selection } from "./repositoryApi";

export type FileNode = {
  id: string;
  path: string;
  name: string;
  parent: string;
  language: string;
  status: "parsed" | "failed";
  sha256: string;
};
export type FileEdge = {
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
};
export type Graph = {
  schemaVersion: 1;
  analyzerVersion: string;
  manifest: string;
  repositoryId: string;
  revision: number;
  directories: string[];
  files: FileNode[];
  edges: FileEdge[];
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

const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const text = (v: unknown): v is string => typeof v === "string" && v.length > 0;
const count = (v: unknown): v is number =>
  Number.isSafeInteger(v) && (v as number) >= 0;
const path = (v: unknown): v is string =>
  text(v) &&
  v.length <= 1024 &&
  !v.startsWith("/") &&
  !/[\\%\0]/.test(v) &&
  !v.split("/").some((part) => !part || part === "." || part === "..");
const file = (v: unknown): v is FileNode =>
  object(v) &&
  text(v.id) &&
  path(v.path) &&
  text(v.name) &&
  v.name === v.path.split("/").at(-1) &&
  (v.parent === "." || path(v.parent)) &&
  v.parent ===
    (v.path.includes("/") ? v.path.slice(0, v.path.lastIndexOf("/")) : ".") &&
  text(v.language) &&
  (v.status === "parsed" || v.status === "failed") &&
  text(v.sha256);
const edge = (v: unknown): v is FileEdge =>
  object(v) &&
  text(v.id) &&
  text(v.from) &&
  (v.to === null || text(v.to)) &&
  (v.kind === "imports" || v.kind === "reexports") &&
  (v.resolution === "resolved_static" ||
    v.resolution === "unresolved" ||
    v.resolution === "external") &&
  typeof v.specifier === "string" &&
  object(v.evidence) &&
  path(v.evidence.path) &&
  count(v.evidence.line) &&
  v.evidence.line > 0 &&
  count(v.evidence.column) &&
  v.evidence.column > 0 &&
  text(v.evidence.rule) &&
  text(v.evidence.sha256);

function validated(value: unknown, repo: Selection): Graph {
  if (
    !object(value) ||
    value.schemaVersion !== 1 ||
    value.repositoryId !== repo.repositoryId ||
    value.revision !== repo.revision ||
    !text(value.manifest) ||
    !text(value.analyzerVersion) ||
    !Array.isArray(value.directories) ||
    !value.directories.every(path) ||
    !Array.isArray(value.files) ||
    value.files.length > 200 ||
    !value.files.every(file) ||
    !Array.isArray(value.edges) ||
    value.edges.length > 1000 ||
    !value.edges.every(edge) ||
    !Array.isArray(value.diagnostics) ||
    !value.diagnostics.every(
      (d: unknown) =>
        object(d) &&
        path(d.path) &&
        text(d.code) &&
        (d.line === undefined || count(d.line)),
    ) ||
    !object(value.counts) ||
    !count(value.counts.files) ||
    !count(value.counts.resolved) ||
    !count(value.counts.unresolved) ||
    !count(value.counts.skipped) ||
    !count(value.counts.bytes) ||
    value.counts.files !== value.files.length ||
    typeof value.partial !== "boolean"
  )
    throw new ApiError(
      "INVALID_RESPONSE",
      "Local API returned an invalid graph.",
    );
  const ids = new Set(value.files.map((f: FileNode) => f.id));
  if (
    ids.size !== value.files.length ||
    new Set(value.files.map((f: FileNode) => f.path)).size !==
      value.files.length ||
    value.edges.some(
      (e: FileEdge) =>
        !ids.has(e.from) ||
        (e.resolution === "resolved_static"
          ? !e.to || !ids.has(e.to)
          : e.to !== null),
    )
  )
    throw new ApiError(
      "INVALID_RESPONSE",
      "Local API returned an invalid graph.",
    );
  return value as Graph;
}

export async function getGraph(
  repo: Selection,
  signal?: AbortSignal,
): Promise<Graph> {
  return validated(await request("/api/v1/repository/graph", { signal }), repo);
}
export async function analyzeRepository(
  repo: Selection,
  signal?: AbortSignal,
): Promise<Graph> {
  return validated(
    await request(
      "/api/v1/repository/analyze",
      json(
        "POST",
        { repositoryId: repo.repositoryId, revision: repo.revision },
        signal,
      ),
    ),
    repo,
  );
}
