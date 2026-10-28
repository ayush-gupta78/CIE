import type { Graph } from "./graph.js";

type File = Graph["files"][number];
const compare = (a: File, b: File) =>
  a.path < b.path ? -1 : a.path > b.path ? 1 : 0;

// ponytail: bounded by graph v1's 200 files/1000 declarations; precompute only if that ceiling rises.
function connections(graph: Graph) {
  const files = [...graph.files].sort(compare);
  const byId = new Map(files.map((file) => [file.id, file]));
  const outgoing = new Map(files.map((file) => [file.id, new Set<string>()]));
  const incoming = new Map(files.map((file) => [file.id, new Set<string>()]));
  let declarations = 0;
  let unresolved = 0;
  let external = 0;
  for (const edge of graph.edges) {
    if (edge.resolution === "unresolved") unresolved++;
    if (edge.resolution === "external") external++;
    if (
      edge.resolution !== "resolved_static" ||
      !edge.to ||
      !byId.has(edge.from) ||
      !byId.has(edge.to)
    )
      continue;
    declarations++;
    outgoing.get(edge.from)!.add(edge.to);
    incoming.get(edge.to)!.add(edge.from);
  }
  const ordered = (ids: Iterable<string>) =>
    [...ids].sort((a, b) => compare(byId.get(a)!, byId.get(b)!));
  return {
    files,
    byId,
    outgoing,
    incoming,
    ordered,
    declarations,
    unresolved,
    external,
  };
}

export function impact(graph: Graph, fileId: string) {
  const { byId, incoming, ordered } = connections(graph);
  const seen = new Map<string, string[]>();
  seen.set(fileId, [fileId]);
  const queue = [fileId];
  for (let i = 0; i < queue.length; i++) {
    const current = queue[i];
    for (const next of ordered(incoming.get(current)!)) {
      if (seen.has(next)) continue;
      seen.set(next, [...seen.get(current)!, next]);
      queue.push(next);
    }
  }
  const affected = [...seen]
    .filter(([id]) => id !== fileId)
    .map(([id, chain]) => ({
      id,
      path: byId.get(id)!.path,
      parent: byId.get(id)!.parent,
      distance: chain.length - 1,
      chain,
    }))
    .sort(
      (a, b) =>
        a.distance - b.distance || compare(byId.get(a.id)!, byId.get(b.id)!),
    );
  return {
    repositoryId: graph.repositoryId,
    revision: graph.revision,
    manifest: graph.manifest,
    fileId,
    total: affected.length,
    direct: affected
      .filter((file) => file.distance === 1)
      .map((file) => file.id),
    indirect: affected
      .filter((file) => file.distance > 1)
      .map((file) => file.id),
    affected,
  };
}

export function insights(graph: Graph) {
  const {
    files,
    outgoing,
    incoming,
    ordered,
    declarations,
    unresolved,
    external,
  } = connections(graph);
  const reach = (source: string, adjacency: Map<string, Set<string>>) => {
    const visited = new Set([source]);
    const queue = [source];
    for (let i = 0; i < queue.length; i++)
      for (const next of adjacency.get(queue[i])!)
        if (!visited.has(next)) {
          visited.add(next);
          queue.push(next);
        }
    return visited.size - 1;
  };
  let index = 0;
  const indices = new Map<string, number>();
  const low = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const groups: string[][] = [];
  const visit = (id: string) => {
    indices.set(id, index);
    low.set(id, index++);
    stack.push(id);
    onStack.add(id);
    for (const next of ordered(outgoing.get(id)!)) {
      if (!indices.has(next)) {
        visit(next);
        low.set(id, Math.min(low.get(id)!, low.get(next)!));
      } else if (onStack.has(next))
        low.set(id, Math.min(low.get(id)!, indices.get(next)!));
    }
    if (low.get(id) === indices.get(id)) {
      const members: string[] = [];
      let member: string;
      do {
        member = stack.pop()!;
        onStack.delete(member);
        members.push(member);
      } while (member !== id);
      const sorted = ordered(members);
      if (sorted.length > 1 || outgoing.get(id)!.has(id)) groups.push(sorted);
    }
  };
  for (const file of files) if (!indices.has(file.id)) visit(file.id);
  groups.sort(
    (a, b) =>
      files.findIndex((file) => file.id === a[0]) -
      files.findIndex((file) => file.id === b[0]),
  );
  const cycleIds = new Map(files.map((file) => [file.id, [] as number[]]));
  const cycles = groups.map((members, i) => {
    const id = i + 1;
    for (const member of members) cycleIds.get(member)!.push(id);
    const within = new Set(members);
    const relationships = members.flatMap((from) =>
      ordered(outgoing.get(from)!)
        .filter((to) => within.has(to))
        .map((to) => ({ from, to })),
    );
    const start = members[0];
    const trail = [start];
    const active = new Set([start]);
    const find = (current: string): boolean => {
      for (const next of ordered(outgoing.get(current)!).filter((target) =>
        within.has(target),
      )) {
        if (next === start) {
          trail.push(start);
          return true;
        }
        if (active.has(next)) continue;
        active.add(next);
        trail.push(next);
        if (find(next)) return true;
        trail.pop();
        active.delete(next);
      }
      return false;
    };
    find(start);
    return { id, files: members, relationships, witness: trail };
  });
  const statuses = {
    parsed: 0,
    partial: 0,
    unsupported: 0,
    skipped: 0,
    failed: 0,
  };
  const results = files.map((file) => {
    statuses[file.status]++;
    return {
      id: file.id,
      path: file.path,
      parent: file.parent,
      status: file.status,
      directDependencies: outgoing.get(file.id)!.size,
      directDependents: incoming.get(file.id)!.size,
      transitiveDependencies: reach(file.id, outgoing),
      transitiveDependents: reach(file.id, incoming),
      cycleIds: cycleIds.get(file.id)!,
    };
  });
  return {
    repositoryId: graph.repositoryId,
    revision: graph.revision,
    manifest: graph.manifest,
    totals: {
      files: files.length,
      relationships: results.reduce(
        (n, file) => n + file.directDependencies,
        0,
      ),
      declarations,
      unresolved,
      external,
      cycleGroups: cycles.length,
      cycleFiles: groups.reduce((n, group) => n + group.length, 0),
      isolated: results.filter(
        (file) => !file.directDependencies && !file.directDependents,
      ).length,
      statuses,
    },
    files: results,
    cycles,
  };
}
