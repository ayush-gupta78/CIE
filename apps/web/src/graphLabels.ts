import type { FileNode } from "./graphApi";

type Candidate = { id: string; x: number; y: number; priority: number };

// The selected file claims its space first; unrelated labels yield at overview scale.
export function visibleLabelIds(
  candidates: Candidate[],
  width: number,
  height: number,
  all: boolean,
): Set<string> {
  const seen = new Set<string>();
  const boxes: { x: number; y: number }[] = [];
  for (const item of [...candidates].sort(
    (a, b) => b.priority - a.priority || a.id.localeCompare(b.id),
  )) {
    if (
      item.x < 80 ||
      item.x > width - 80 ||
      item.y < 38 ||
      item.y > height - 55
    )
      continue;
    if (!all && item.priority === 0) continue;
    if (
      boxes.some(
        (box) =>
          Math.abs(box.x - item.x) < 116 && Math.abs(box.y - item.y) < 32,
      )
    )
      continue;
    boxes.push(item);
    seen.add(item.id);
  }
  return seen;
}

export function shortFileLabels(files: FileNode[]): Map<string, string> {
  const names = new Map<string, number>();
  for (const file of files)
    names.set(file.name, (names.get(file.name) ?? 0) + 1);
  return new Map(
    files.map((file) => [
      file.id,
      names.get(file.name) === 1 ? file.name : file.path,
    ]),
  );
}
