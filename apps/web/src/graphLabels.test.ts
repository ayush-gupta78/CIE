import { expect, it } from "vitest";
import { shortFileLabels, visibleLabelIds } from "./graphLabels";
import type { FileNode } from "./graphApi";

const file = (path: string): FileNode => ({
  id: path,
  path,
  name: path.split("/").at(-1)!,
  parent: path.slice(0, path.lastIndexOf("/")),
  language: "TypeScript",
  status: "parsed",
  sha256: "hash",
});

it("disambiguates duplicate basenames without inventing labels", () => {
  const labels = shortFileLabels([
    file("apps/web/index.ts"),
    file("apps/server/index.ts"),
    file("apps/web/App.tsx"),
  ]);
  expect(labels.get("apps/web/index.ts")).toBe("apps/web/index.ts");
  expect(labels.get("apps/server/index.ts")).toBe("apps/server/index.ts");
  expect(labels.get("apps/web/App.tsx")).toBe("App.tsx");
});

it("prioritizes selected and directly related labels over collisions, even with all labels", () => {
  const dense = Array.from({ length: 60 }, (_, i) => ({
    id: String(i),
    x: 300 + (i % 3),
    y: 180 + (i % 3),
    priority: i === 59 ? 4 : i === 58 ? 3 : 0,
  }));
  expect([...visibleLabelIds(dense, 800, 500, false)]).toEqual(["59"]);
  expect([...visibleLabelIds(dense, 800, 500, true)]).toEqual(["59"]);
  expect(
    visibleLabelIds(
      [{ id: "outside", x: -2, y: 20, priority: 4 }],
      800,
      500,
      true,
    ).size,
  ).toBe(0);
});

it("keeps a selected label visible near the edge of a narrow stage", () => {
  expect(
    visibleLabelIds(
      [{ id: "selected", x: 286, y: 200, priority: 4 }],
      360,
      438,
      false,
    ).has("selected"),
  ).toBe(true);
  expect(
    visibleLabelIds(
      [{ id: "clipped", x: 330, y: 200, priority: 4 }],
      360,
      438,
      false,
    ).has("clipped"),
  ).toBe(false);
});
