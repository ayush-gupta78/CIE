import { groupColor, type SceneModel } from "./graphModel";

export type Box = { x: number; y: number; width: number; height: number };
export type Point2D = { x: number; y: number };
export type Layout2D = {
  nodes: Map<string, Point2D>;
  groups: {
    path: string;
    x: number;
    y: number;
    radius: number;
    color: string;
    count: number;
  }[];
  bounds: Box;
};

export function layoutGraph2D(model: SceneModel): Layout2D {
  const files = model.files;
  if (!files.length)
    return {
      nodes: new Map(),
      groups: [],
      bounds: { x: -150, y: -100, width: 300, height: 200 },
    };
  const index = new Map(files.map((file, i) => [file.id, i]));
  const links = [...model.connections]
    .filter((edge) => index.has(edge.from) && index.has(edge.to))
    .sort(
      (a, b) =>
        a.from.localeCompare(b.from, "en") ||
        a.to.localeCompare(b.to, "en") ||
        a.kind.localeCompare(b.kind, "en"),
    );
  const degrees = new Map<string, number>();
  for (const link of links) {
    degrees.set(link.from, (degrees.get(link.from) ?? 0) + link.count);
    degrees.set(link.to, (degrees.get(link.to) ?? 0) + link.count);
  }
  const sortedGroups = [...model.groups].sort((a, b) => {
    const weight = (group: typeof a) =>
      group.files.reduce((sum, file) => sum + (degrees.get(file.id) ?? 0), 0);
    return weight(b) - weight(a) || a.path.localeCompare(b.path, "en");
  });
  const anchors = new Map<string, Point2D>();
  const placed: { x: number; y: number; radius: number }[] = [];
  for (const group of sortedGroups) {
    const radius = Math.max(68, Math.sqrt(group.files.length) * 40);
    let anchor = { x: 0, y: 0 };
    for (let candidate = 0; candidate < 4000; candidate++) {
      const angle = candidate * 2.399963229728653;
      const distance = Math.sqrt(candidate) * 95;
      anchor = { x: Math.cos(angle) * distance, y: Math.sin(angle) * distance };
      if (
        placed.every(
          (other) =>
            Math.hypot(anchor.x - other.x, anchor.y - other.y) >=
            radius + other.radius + 65,
        )
      )
        break;
    }
    anchors.set(group.path, anchor);
    placed.push({ ...anchor, radius });
  }
  const positions = files.map((file) => {
    const group = sortedGroups.find((entry) => entry.path === file.parent)!;
    const local = group.files.findIndex((entry) => entry.id === file.id);
    const angle = local * 2.399963229728653;
    const distance = Math.sqrt(local) * 38;
    const anchor = anchors.get(file.parent)!;
    return {
      x: anchor.x + Math.cos(angle) * distance,
      y: anchor.y + Math.sin(angle) * distance,
    };
  });
  const separate = () => {
    let moved = false;
    for (let i = 0; i < positions.length; i++)
      for (let j = i + 1; j < positions.length; j++) {
        let dx = positions[j].x - positions[i].x;
        let dy = positions[j].y - positions[i].y;
        let distance = Math.hypot(dx, dy);
        if (distance >= 54) continue;
        moved = true;
        if (distance < 0.001) {
          dx = 1;
          dy = 0;
          distance = 1;
        }
        const shift = (54 - distance) / (2 * distance);
        positions[i].x -= dx * shift;
        positions[i].y -= dy * shift;
        positions[j].x += dx * shift;
        positions[j].y += dy * shift;
      }
    return moved;
  };
  // ponytail: bounded O(iterations × files²) relaxation; the 200-file server cap keeps it finite.
  for (let iteration = 0; iteration < 90; iteration++) {
    const forces = positions.map(() => ({ x: 0, y: 0 }));
    for (let i = 0; i < positions.length; i++) {
      for (let j = i + 1; j < positions.length; j++) {
        const dx = positions[j].x - positions[i].x;
        const dy = positions[j].y - positions[i].y;
        const distance = Math.max(0.001, Math.hypot(dx, dy));
        if (distance >= 120) continue;
        const amount = ((120 - distance) * 0.024) / distance;
        forces[i].x -= dx * amount;
        forces[i].y -= dy * amount;
        forces[j].x += dx * amount;
        forces[j].y += dy * amount;
      }
    }
    for (const link of links) {
      const a = index.get(link.from)!;
      const b = index.get(link.to)!;
      if (a === b) continue;
      const dx = positions[b].x - positions[a].x;
      const dy = positions[b].y - positions[a].y;
      const distance = Math.max(0.001, Math.hypot(dx, dy));
      const amount =
        Math.min(18, Math.max(-18, (distance - 104) * 0.045)) / distance;
      forces[a].x += dx * amount;
      forces[a].y += dy * amount;
      forces[b].x -= dx * amount;
      forces[b].y -= dy * amount;
    }
    for (let i = 0; i < files.length; i++) {
      const anchor = anchors.get(files[i].parent)!;
      forces[i].x += (anchor.x - positions[i].x) * 0.012;
      forces[i].y += (anchor.y - positions[i].y) * 0.012;
      positions[i].x += Math.max(-16, Math.min(16, forces[i].x));
      positions[i].y += Math.max(-16, Math.min(16, forces[i].y));
    }
    separate();
  }
  for (let pass = 0; pass < 40; pass++) if (!separate()) break;
  // Align the network's longest axis with the panoramic stage without changing its links.
  const meanX =
    positions.reduce((sum, point) => sum + point.x, 0) / positions.length;
  const meanY =
    positions.reduce((sum, point) => sum + point.y, 0) / positions.length;
  const xx = positions.reduce((sum, point) => sum + (point.x - meanX) ** 2, 0);
  const yy = positions.reduce((sum, point) => sum + (point.y - meanY) ** 2, 0);
  const xy = positions.reduce(
    (sum, point) => sum + (point.x - meanX) * (point.y - meanY),
    0,
  );
  const angle = Math.atan2(2 * xy, xx - yy) / 2;
  const cosine = Math.cos(angle),
    sine = Math.sin(angle);
  for (const point of positions) {
    const x = point.x - meanX,
      y = point.y - meanY;
    point.x = (x * cosine + y * sine) * 1.65;
    point.y = -x * sine + y * cosine;
  }
  const nodes = new Map(files.map((file, i) => [file.id, positions[i]]));
  const groups = model.groups.map((group) => {
    const members = group.files.map((file) => nodes.get(file.id)!);
    const x = members.reduce((sum, point) => sum + point.x, 0) / members.length;
    const y = members.reduce((sum, point) => sum + point.y, 0) / members.length;
    return {
      path: group.path,
      x,
      y,
      radius:
        Math.max(
          30,
          ...members.map((point) => Math.hypot(point.x - x, point.y - y)),
        ) + 24,
      color: groupColor(group.path),
      count: members.length,
    };
  });
  const minX = Math.min(...positions.map((point) => point.x)) - 80;
  const maxX = Math.max(...positions.map((point) => point.x)) + 80;
  const minY = Math.min(...positions.map((point) => point.y)) - 80;
  const maxY = Math.max(...positions.map((point) => point.y)) + 80;
  return {
    nodes,
    groups,
    bounds: { x: minX, y: minY, width: maxX - minX, height: maxY - minY },
  };
}

export function frameBox(box: Box, width: number, height: number, maxZoom = 2) {
  const scale = Math.min(
    maxZoom,
    Math.max(
      0.0001,
      Math.min((width - 36) / box.width, (height - 36) / box.height),
    ),
  );
  return {
    x: width / 2 - (box.x + box.width / 2) * scale,
    y: height / 2 - (box.y + box.height / 2) * scale,
    scale,
  };
}
