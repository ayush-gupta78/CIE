import { ApiError, request, type Selection } from "./repositoryApi";
import type { Graph } from "./graphApi";

export type InsightFile = {
  id: string;
  path: string;
  parent: string;
  status: Graph["files"][number]["status"];
  directDependencies: number;
  directDependents: number;
  transitiveDependencies: number;
  transitiveDependents: number;
  cycleIds: number[];
};
export type Insights = {
  repositoryId: string;
  revision: number;
  manifest: string;
  totals: {
    files: number;
    relationships: number;
    declarations: number;
    unresolved: number;
    external: number;
    cycleGroups: number;
    cycleFiles: number;
    isolated: number;
    statuses: Record<InsightFile["status"], number>;
  };
  files: InsightFile[];
  cycles: {
    id: number;
    files: string[];
    relationships: { from: string; to: string }[];
    witness: string[];
  }[];
};
export type Impact = {
  repositoryId: string;
  revision: number;
  manifest: string;
  fileId: string;
  total: number;
  direct: string[];
  indirect: string[];
  affected: {
    id: string;
    path: string;
    parent: string;
    distance: number;
    chain: string[];
  }[];
};
const obj = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const num = (v: unknown): v is number =>
  Number.isSafeInteger(v) && (v as number) >= 0;
const ids = (v: unknown, known: Set<string>): v is string[] =>
  Array.isArray(v) &&
  v.every((id) => typeof id === "string" && known.has(id)) &&
  new Set(v).size === v.length;
const invalid = (): never => {
  throw new ApiError(
    "INVALID_RESPONSE",
    "Local API returned invalid findings.",
  );
};
const identity = (
  v: unknown,
  repo: Selection,
  graph: Graph,
): v is Record<string, unknown> =>
  obj(v) &&
  graph.repositoryId === repo.repositoryId &&
  graph.revision === repo.revision &&
  v.repositoryId === repo.repositoryId &&
  v.revision === repo.revision &&
  v.manifest === graph.manifest;
const params = (repo: Selection, graph: Graph) =>
  new URLSearchParams({
    repositoryId: repo.repositoryId,
    revision: String(repo.revision),
    manifest: graph.manifest,
  });
const verified = (graph: Graph) => {
  const known = new Map(graph.files.map((file) => [file.id, file]));
  const outgoing = new Map(
    [...known.keys()].map((id) => [id, new Set<string>()]),
  );
  const incoming = new Map(
    [...known.keys()].map((id) => [id, new Set<string>()]),
  );
  const relationships = new Set<string>();
  let declarations = 0;
  let unresolved = 0;
  let external = 0;
  for (const edge of graph.edges) {
    if (edge.resolution === "unresolved") unresolved++;
    if (edge.resolution === "external") external++;
    if (
      edge.resolution !== "resolved_static" ||
      !edge.to ||
      !known.has(edge.from) ||
      !known.has(edge.to)
    )
      continue;
    declarations++;
    relationships.add(`${edge.from}\0${edge.to}`);
    outgoing.get(edge.from)!.add(edge.to);
    incoming.get(edge.to)!.add(edge.from);
  }
  return {
    known,
    outgoing,
    incoming,
    relationships,
    declarations,
    unresolved,
    external,
  };
};

export async function getInsights(
  repo: Selection,
  graph: Graph,
  signal?: AbortSignal,
): Promise<Insights> {
  const response = await request(
    `/api/v1/repository/insights?${params(repo, graph)}`,
    { signal },
  );
  if (
    !identity(response, repo, graph) ||
    !obj(response.totals) ||
    !obj(response.totals.statuses) ||
    !Array.isArray(response.files) ||
    !Array.isArray(response.cycles)
  )
    invalid();
  const value = response as Insights;
  const t = value.totals;
  const {
    known,
    outgoing,
    incoming,
    relationships,
    declarations,
    unresolved,
    external,
  } = verified(graph);
  const statuses = [
    "parsed",
    "partial",
    "unsupported",
    "skipped",
    "failed",
  ] as const;
  if (
    value.files.length !== graph.files.length ||
    value.files.length > 200 ||
    value.cycles.length > 200 ||
    ![
      t.files,
      t.relationships,
      t.declarations,
      t.unresolved,
      t.external,
      t.cycleGroups,
      t.cycleFiles,
      t.isolated,
    ].every(num) ||
    !statuses.every(
      (s) =>
        num((t.statuses as Record<string, unknown>)[s]) &&
        t.statuses[s] === graph.files.filter((f) => f.status === s).length,
    ) ||
    t.files !== graph.files.length ||
    t.relationships !== relationships.size ||
    t.declarations !== declarations ||
    t.unresolved !== unresolved ||
    t.external !== external ||
    t.cycleGroups !== value.cycles.length ||
    !value.files.every(
      (f: unknown) =>
        obj(f) &&
        typeof f.id === "string" &&
        known.has(f.id) &&
        f.path === known.get(f.id)?.path &&
        f.parent === known.get(f.id)?.parent &&
        f.status === known.get(f.id)?.status &&
        [
          f.directDependencies,
          f.directDependents,
          f.transitiveDependencies,
          f.transitiveDependents,
        ].every(num) &&
        [
          f.directDependencies,
          f.directDependents,
          f.transitiveDependencies,
          f.transitiveDependents,
        ].every((n) => (n as number) <= graph.files.length) &&
        Array.isArray(f.cycleIds) &&
        f.cycleIds.every(num) &&
        new Set(f.cycleIds).size === f.cycleIds.length,
    ) ||
    new Set(value.files.map((f: InsightFile) => f.id)).size !==
      graph.files.length
  )
    invalid();
  const fileMap = new Map((value.files as InsightFile[]).map((f) => [f.id, f]));
  const cycleIds = new Set<number>();
  const knownIds = new Set(known.keys());
  if (
    value.cycles.some((c: unknown) => {
      if (
        !obj(c) ||
        !num(c.id) ||
        cycleIds.has(c.id) ||
        !ids(c.files, knownIds) ||
        c.files.length === 0 ||
        !Array.isArray(c.relationships) ||
        !Array.isArray(c.witness) ||
        c.witness.length < 2 ||
        c.witness.some(
          (id: unknown) => typeof id !== "string" || !knownIds.has(id),
        ) ||
        c.witness[0] !== c.witness.at(-1)
      )
        return true;
      cycleIds.add(c.id as number);
      const members = new Set(c.files as string[]);
      return (
        (c.relationships as unknown[]).some(
          (r) =>
            !obj(r) ||
            !members.has(r.from as string) ||
            !members.has(r.to as string) ||
            !relationships.has(`${r.from}\0${r.to}`),
        ) ||
        (c.witness as string[]).some((id) => !members.has(id)) ||
        (c.witness as string[])
          .slice(1)
          .some(
            (id, i) =>
              !relationships.has(`${(c.witness as string[])[i]}\0${id}`),
          )
      );
    }) ||
    t.cycleFiles !==
      value.files.filter((f: InsightFile) => f.cycleIds.length > 0).length ||
    (value.files as InsightFile[]).some((f) =>
      f.cycleIds.some(
        (id) =>
          !cycleIds.has(id) ||
          !(value.cycles as Insights["cycles"])
            .find((c) => c.id === id)
            ?.files.includes(f.id),
      ),
    ) ||
    (value.cycles as Insights["cycles"]).some((c) =>
      c.files.some((id) => !fileMap.get(id)?.cycleIds.includes(c.id)),
    )
  )
    invalid();
  const reach = (id: string, adjacency: Map<string, Set<string>>) => {
    const seen = new Set([id]);
    const queue = [id];
    for (const current of queue)
      for (const next of adjacency.get(current)!) {
        if (seen.has(next)) continue;
        seen.add(next);
        queue.push(next);
      }
    return seen.size - 1;
  };
  if (
    (value.files as InsightFile[]).some(
      (f) =>
        f.directDependencies !== outgoing.get(f.id)!.size ||
        f.directDependents !== incoming.get(f.id)!.size ||
        f.transitiveDependencies !== reach(f.id, outgoing) ||
        f.transitiveDependents !== reach(f.id, incoming),
    ) ||
    t.isolated !==
      value.files.filter(
        (f: InsightFile) =>
          f.directDependencies === 0 && f.directDependents === 0,
      ).length
  )
    invalid();
  return value as Insights;
}

export async function getImpact(
  repo: Selection,
  graph: Graph,
  fileId: string,
  signal?: AbortSignal,
): Promise<Impact> {
  const known = new Map(graph.files.map((f) => [f.id, f]));
  if (!known.has(fileId)) invalid();
  const query = params(repo, graph);
  query.set("fileId", fileId);
  const response = await request(`/api/v1/repository/impact?${query}`, {
    signal,
  });
  if (
    !identity(response, repo, graph) ||
    !Array.isArray(response.direct) ||
    !Array.isArray(response.indirect) ||
    !Array.isArray(response.affected)
  )
    invalid();
  const value = response as Impact;
  const relationships = verified(graph).relationships;
  if (
    value.fileId !== fileId ||
    !num(value.total) ||
    !ids(value.direct, new Set(known.keys())) ||
    !ids(value.indirect, new Set(known.keys())) ||
    !Array.isArray(value.affected) ||
    value.total !== value.affected.length ||
    value.total > graph.files.length - 1 ||
    value.total !== value.direct.length + value.indirect.length ||
    new Set([...value.direct, ...value.indirect]).size !== value.total ||
    !value.affected.every(
      (a: unknown) =>
        obj(a) &&
        typeof a.id === "string" &&
        a.id !== fileId &&
        known.has(a.id) &&
        a.path === known.get(a.id)?.path &&
        a.parent === known.get(a.id)?.parent &&
        num(a.distance) &&
        a.distance > 0 &&
        a.distance < graph.files.length &&
        Array.isArray(a.chain) &&
        new Set(a.chain).size === a.chain.length &&
        a.chain.length === a.distance + 1 &&
        a.chain[0] === fileId &&
        a.chain.at(-1) === a.id &&
        a.chain.every(
          (id: unknown) => typeof id === "string" && known.has(id),
        ) &&
        a.chain
          .slice(1)
          .every((id: string, i: number) =>
            relationships.has(`${id}\0${(a.chain as string[])[i]}`),
          ) &&
        (a.distance === 1
          ? value.direct.includes(a.id)
          : value.indirect.includes(a.id)),
    ) ||
    new Set(value.affected.map((a: Impact["affected"][number]) => a.id))
      .size !== value.total
  )
    invalid();
  return value as Impact;
}
