import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { PerspectiveCamera, Vector3 } from "three";
import { CameraRig } from "./GraphScene3D";
import type { SceneModel, Point } from "./graphModel";

const viewport = vi.hoisted(() => ({ width: 1200, height: 600 }));
vi.mock("@react-three/fiber", () => ({
  useThree: () => ({ camera, gl, invalidate, size: { ...viewport } }),
  Canvas: () => null,
  useFrame: () => {},
}));
const canvas = document.createElement("canvas");
const gl = { domElement: canvas };
const invalidate = () => {};
const camera = new PerspectiveCamera(55, 2, 0.1, 2000);
const positions = new Map<string, Point>([
  ["selected", [0, 0, 0]],
  ["near-a", [0, 0, -22]],
  ["near-b", [0, 0, 22]],
  ["high", [0, 100, 0]],
  ["low", [0, -100, 0]],
]);
const files = [...positions.keys()].map((id) => ({
  id,
  name: id,
  path: `src/${id}.ts`,
  parent: "src",
  status: "parsed" as const,
  language: "TypeScript",
}));
const model: SceneModel = {
  files,
  groups: [{ path: "src", files, color: "#fff" }],
  connections: [],
  incoming: new Map(),
  outgoing: new Map([
    [
      "selected",
      [
        { from: "selected", to: "near-a" },
        { from: "selected", to: "near-b" },
      ] as SceneModel["outgoing"] extends Map<string, infer E> ? E : never,
    ],
  ]),
};
const layout = {
  positions,
  groups: [{ path: "src", position: [0, 0, 0] as Point, color: "#fff" }],
  zones: [],
  center: [0, 0, 0] as Point,
  radius: 105,
};
const props = {
  model,
  layout,
  focusId: "selected",
  focusModule: null,
  focusToken: 1,
  resetToken: 0,
  orbitToken: 0,
  cameraCommand: "reset" as const,
};

afterEach(cleanup);

it("keeps a selected neighborhood visible across portrait and landscape resizes without resetting orbit", () => {
  viewport.width = 1200;
  viewport.height = 600;
  camera.aspect = 2;
  const view = render(<CameraRig {...props} />);
  view.rerender(<CameraRig {...props} orbitToken={1} />);
  view.rerender(<CameraRig {...props} orbitToken={2} focusToken={2} />);
  const direction = new Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
  const framed = () =>
    ["selected", "near-a", "near-b"].every((id) => {
      const point = new Vector3(...positions.get(id)!).project(camera);
      return Math.abs(point.x) < 0.95 && Math.abs(point.y) < 0.95;
    });
  expect(framed()).toBe(true);
  const beforeSmallResize = camera.position.clone();
  viewport.width = 1190;
  camera.aspect = 1190 / 600;
  camera.updateProjectionMatrix();
  view.rerender(<CameraRig {...props} orbitToken={2} focusToken={2} />);
  expect(camera.position.distanceTo(beforeSmallResize)).toBeLessThan(1);
  viewport.width = 360;
  viewport.height = 720;
  camera.aspect = 0.5;
  camera.updateProjectionMatrix();
  view.rerender(<CameraRig {...props} orbitToken={2} focusToken={2} />);
  expect(framed()).toBe(true);
  expect(
    new Vector3(0, 0, -1)
      .applyQuaternion(camera.quaternion)
      .distanceTo(direction),
  ).toBeLessThan(0.001);
  viewport.width = 1200;
  viewport.height = 600;
  camera.aspect = 2;
  camera.updateProjectionMatrix();
  view.rerender(<CameraRig {...props} orbitToken={2} focusToken={2} />);
  expect(framed()).toBe(true);
  expect(
    new Vector3(0, 0, -1)
      .applyQuaternion(camera.quaternion)
      .distanceTo(direction),
  ).toBeLessThan(0.001);
});
