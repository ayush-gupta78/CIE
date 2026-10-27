import type { SceneModel } from "./graphModel";
import { buildFileTree } from "./GraphFileTree";

export type Box = { x: number; y: number; width: number; height: number };
export type Layout2D = {
  nodes: Map<string, Box>;
  directories: Map<string, Box>;
  bounds: Box;
};

const FILE_WIDTH = 248;
const ROW = 38;
const PAD = 20;
const INDENT = 18;
const GAP = 26;
const FILE_GAP = 12;

export function layoutGraph2D(model: SceneModel): Layout2D {
  const nodes = new Map<string, Box>();
  const directories = new Map<string, Box>();
  const tree = buildFileTree(model.files);
  type Directory = typeof tree;
  // Each directory encloses its own files and its actual children, including empty intermediate paths.
  function place(dir: Directory, x: number, y: number): Box {
    let cursor = y + 42;
    const columns = Math.min(
      3,
      Math.max(1, Math.ceil(Math.sqrt(dir.files.length / 2))),
    );
    let width = PAD * 2 + columns * FILE_WIDTH + (columns - 1) * FILE_GAP;
    dir.files.forEach((file, index) => {
      nodes.set(file.id, {
        x: x + PAD + (index % columns) * (FILE_WIDTH + FILE_GAP),
        y: cursor + Math.floor(index / columns) * ROW,
        width: FILE_WIDTH,
        height: 30,
      });
    });
    cursor += Math.ceil(dir.files.length / columns) * ROW;
    for (const child of [...dir.children].sort((a, b) =>
      a.path.localeCompare(b.path, "en"),
    )) {
      const box = place(child, x + INDENT, cursor);
      width = Math.max(width, box.x + box.width - x + PAD);
      cursor += box.height + 8;
    }
    const box = { x, y, width, height: Math.max(76, cursor - y + 8) };
    directories.set(dir.path, box);
    return box;
  }
  const roots = [...tree.children].sort((a, b) =>
    a.path.localeCompare(b.path, "en"),
  );
  const measureWidth = (dir: Directory): number => {
    const columns = Math.min(
      3,
      Math.max(1, Math.ceil(Math.sqrt(dir.files.length / 2))),
    );
    return Math.max(
      PAD * 2 + columns * FILE_WIDTH + (columns - 1) * FILE_GAP,
      ...dir.children.map((child) => INDENT + PAD + measureWidth(child)),
    );
  };
  const leftWidth = Math.max(
    288,
    tree.files.length ? measureWidth({ ...tree, children: [] }) : 0,
    ...roots.filter((_, index) => index % 2 === 0).map(measureWidth),
  );
  let left = PAD;
  let right = PAD;
  let bottom = PAD;
  if (tree.files.length) {
    const box = place({ ...tree, children: [], files: tree.files }, PAD, PAD);
    left += box.height + GAP;
    bottom = Math.max(bottom, box.y + box.height);
  }
  roots.forEach((root, index) => {
    const column = index % 2;
    const x = PAD + column * (leftWidth + GAP);
    const y = column ? right : left;
    const box = place(root, x, y);
    if (column) right += box.height + GAP;
    else left += box.height + GAP;
    bottom = Math.max(bottom, y + box.height);
  });
  if (!tree.files.length && !roots.length) {
    directories.set(".", { x: PAD, y: PAD, width: 288, height: 76 });
    bottom = 96;
  }
  const boxes = [...directories.values()];
  return {
    nodes,
    directories,
    bounds: {
      x: 0,
      y: 0,
      width: Math.max(328, ...boxes.map((box) => box.x + box.width + PAD)),
      height: Math.max(116, bottom + PAD),
    },
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
