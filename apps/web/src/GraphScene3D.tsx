import { Component, useEffect, useMemo, useRef, type ReactNode } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Html, Line } from "@react-three/drei";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import {
  BoxGeometry,
  DoubleSide,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Quaternion,
  Vector3,
} from "three";
import type { FileNode } from "./graphApi";
import { shortFileLabels, visibleLabelIds } from "./graphLabels";
import {
  dependencyArc,
  HOME_DIRECTION,
  homeDistance,
  initialCameraScale,
  type Point,
  type SceneModel,
} from "./graphModel";

type Layout = ReturnType<typeof import("./graphModel").layoutGraph>;
const block = new BoxGeometry(1, 1, 1);
const glass = new MeshStandardMaterial({
  color: "#344553",
  metalness: 0.28,
  roughness: 0.32,
  transparent: true,
  opacity: 0.76,
  depthWrite: false,
  side: DoubleSide,
});
const darkMetal = new MeshStandardMaterial({
  color: "#3b3833",
  metalness: 0.82,
  roughness: 0.3,
});
const floor = new MeshStandardMaterial({
  color: "#131719",
  metalness: 0.58,
  roughness: 0.43,
});
const categoryMaterials = new Map(
  Object.entries({
    source: "#d4ad72",
    web: "#79b9d3",
    data: "#81beb0",
    documentation: "#c6b8df",
    configuration: "#aeb9d6",
    database: "#b1c78d",
    image: "#8dc7c2",
    font: "#c5a6c8",
    media: "#a3b3cf",
    binary: "#a9a6b1",
    unknown: "#989da5",
  }).map(([category, color]) => [category, new MeshBasicMaterial({ color })]),
);

// Stable decorative variation, never a file metric or a second selectable node.
function dimensions(file: FileNode, unit: number) {
  let hash = 0;
  for (const char of file.path) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return {
    height: unit * (4.8 + (hash % 7) * 0.55),
    width: unit * (1.24 + (hash % 3) * 0.16),
    hash,
  };
}

function Beam({
  position,
  scale,
  material,
}: {
  position: Point;
  scale: Point;
  material: MeshBasicMaterial | MeshStandardMaterial;
}) {
  return (
    <mesh
      geometry={block}
      material={material}
      position={position}
      scale={scale}
    />
  );
}

function FileBuilding({
  file,
  unit,
  accent,
  active,
  selected,
  highlighted,
  detailed,
}: {
  file: FileNode;
  unit: number;
  accent: MeshBasicMaterial;
  active: boolean;
  selected: boolean;
  highlighted: boolean;
  detailed: boolean;
}) {
  const { height: h, width: w, hash } = dimensions(file, unit);
  const variant = hash % 3;
  const rib = unit * 0.045;
  return (
    <group>
      {/* A file is one pickable group. Everything below is non-semantic architecture. */}
      <Beam
        position={[0, -0.12, 0]}
        scale={[w * 1.75, 0.26, w * 1.65]}
        material={floor}
      />
      <Beam
        position={[0, 0.03, 0]}
        scale={[w * 1.48, 0.055, w * 1.45]}
        material={darkMetal}
      />
      <Beam
        position={[0, h * 0.48, 0]}
        scale={[w, h * 0.95, w]}
        material={glass}
      />
      <Beam
        position={[0, h * 0.47, 0]}
        scale={[w * 0.36, h * 0.82, w * 0.36]}
        material={floor}
      />
      <Beam
        position={[0, h * 0.51, w * 0.22]}
        scale={[w * 0.08, h * 0.86, w * 0.08]}
        material={accent}
      />
      <Beam
        position={[0, h * 0.84, w * 0.57]}
        scale={[w * 0.2, w * 0.2, 0.04]}
        material={
          categoryMaterials.get(file.category ?? "source") ??
          categoryMaterials.get("unknown")!
        }
      />
      <Beam
        position={[0, h * 0.21, w * 0.54]}
        scale={[w * 0.78, h * 0.37, w * 0.12]}
        material={glass}
      />
      <Beam
        position={[0, h * 0.41, w * 0.57]}
        scale={[w * 0.92, 0.1, w * 0.23]}
        material={darkMetal}
      />
      <Beam
        position={[0, h * 0.42, w * 0.58]}
        scale={[w * 0.62, 0.035, w * 0.04]}
        material={accent}
      />
      {detailed &&
        [-1, 1].map((side) => (
          <group key={side}>
            <Beam
              position={[side * w * 0.32, h * 0.21, w * 0.63]}
              scale={[rib, h * 0.38, rib]}
              material={accent}
            />
            <Beam
              position={[side * w * 0.18, h * 0.53, w * 0.54]}
              scale={[rib, h * 0.72, rib]}
              material={accent}
            />
          </group>
        ))}
      {(detailed ? [0.18, 0.43, 0.68, 0.91] : [0.18, 0.91]).map((level) => (
        <group key={level} position={[0, h * level, 0]}>
          <Beam
            position={[0, 0, w * 0.52]}
            scale={[w * 1.07, rib, rib]}
            material={accent}
          />
          <Beam
            position={[0, 0, -w * 0.52]}
            scale={[w * 1.07, rib, rib]}
            material={darkMetal}
          />
          <Beam
            position={[w * 0.52, 0, 0]}
            scale={[rib, rib, w * 1.07]}
            material={accent}
          />
          <Beam
            position={[-w * 0.52, 0, 0]}
            scale={[rib, rib, w * 1.07]}
            material={darkMetal}
          />
        </group>
      ))}
      {[-1, 1].flatMap((x) =>
        [-1, 1].map((z) => (
          <Beam
            key={`${x}:${z}`}
            position={[x * w * 0.51, h * 0.48, z * w * 0.51]}
            scale={[rib, h * 0.94, rib]}
            material={accent}
          />
        )),
      )}
      {/* Layered setback crown and an illuminated, inset upper chamber. */}
      <Beam
        position={[0, h * 0.94, 0]}
        scale={[w * 1.28, 0.13, w * 1.28]}
        material={darkMetal}
      />
      <Beam
        position={[0, h + w * 0.22, 0]}
        scale={[w * (variant === 0 ? 0.8 : 0.62), w * 0.42, w * 0.67]}
        material={glass}
      />
      <Beam
        position={[0, h + w * 0.44, 0]}
        scale={[w * 1.38, 0.13, w * 1.38]}
        material={accent}
      />
      <Beam
        position={[0, h + w * 0.53, 0]}
        scale={[w * 0.54, 0.09, w * 0.54]}
        material={accent}
      />
      {variant !== 0 && (
        <Beam
          position={[0, h + w * 0.83, 0]}
          scale={[rib, w * 0.56, rib]}
          material={accent}
        />
      )}
      {detailed && variant === 2 && (
        <Beam
          position={[w * 0.52, h * 0.35, 0]}
          scale={[w * 0.36, h * 0.52, w * 0.43]}
          material={glass}
        />
      )}
      {(selected || active) && (
        <Beam
          position={[0, h * 0.2, w * 0.53]}
          scale={[w * 0.44, rib, rib]}
          material={accent}
        />
      )}
      {highlighted && (
        <>
          <mesh
            material={accent}
            rotation={[-Math.PI / 2, 0, 0]}
            position={[0, -0.24, 0]}
          >
            <ringGeometry args={[w * 0.98, w * 1.06, 32]} />
          </mesh>
          {selected && (
            <pointLight
              position={[0, h * 0.78, 0]}
              color="#f9c57a"
              intensity={2.1}
              distance={8}
              decay={2}
            />
          )}
        </>
      )}
    </group>
  );
}
type Props = {
  model: SceneModel;
  layout: Layout;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onHover: (path: string) => void;
  showAllLabels: boolean;
  focusId: string | null;
  focusModule: string | null;
  focusToken: number;
  resetToken: number;
  orbitToken: number;
  cameraCommand: "fit" | "reset";
  onUnavailable: () => void;
};

export function supportsWebGL(): boolean {
  return typeof WebGLRenderingContext !== "undefined";
}

class SceneBoundary extends Component<
  { children: ReactNode; onUnavailable: () => void },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() {
    this.props.onUnavailable();
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

function CameraRig({
  model,
  layout,
  focusId,
  focusModule,
  focusToken,
  resetToken,
  orbitToken,
  cameraCommand,
}: Pick<
  Props,
  | "model"
  | "layout"
  | "focusId"
  | "focusModule"
  | "focusToken"
  | "resetToken"
  | "orbitToken"
  | "cameraCommand"
>) {
  const { camera, gl, invalidate, size } = useThree();
  const controlsRef = useRef<OrbitControls | null>(null);
  const fitPoints = useMemo(
    () => [
      ...layout.positions.values(),
      ...model.files.flatMap((file) => {
        const point = layout.positions.get(file.id);
        return point
          ? [
              [
                point[0],
                point[1] +
                  dimensions(
                    file,
                    Math.min(1.25, Math.max(0.85, layout.radius / 55)),
                  ).height +
                  1,
                point[2],
              ] as Point,
            ]
          : [];
      }),
      ...layout.groups.map((group) => group.position),
    ],
    [layout, model],
  );
  const home = useMemo(
    () => homeDistance(fitPoints, layout.center, size.width / size.height),
    [fitPoints, layout.center, size.width, size.height],
  );
  const homeRef = useRef(home);
  homeRef.current = home;
  const previousHome = useRef(home);
  const previousOrbitToken = useRef(orbitToken);
  const aspectRef = useRef(size.width / size.height);
  aspectRef.current = size.width / size.height;
  const previousScale = useRef(
    initialCameraScale(
      aspectRef.current,
      model.files.length,
      model.groups.length,
    ),
  );
  useEffect(() => {
    const controls = new OrbitControls(camera, gl.domElement);
    controlsRef.current = controls;
    controls.enableDamping = false;
    controls.enablePan = true;
    controls.minDistance = 2;
    controls.maxDistance = Math.max(60, homeRef.current * 3);
    const changed = () => invalidate();
    controls.addEventListener("change", changed);
    return () => {
      controls.removeEventListener("change", changed);
      controls.dispose();
      controlsRef.current = null;
    };
  }, [camera, gl, invalidate]);
  useEffect(() => {
    const controls = controlsRef.current;
    if (controls) {
      controls.maxDistance = Math.max(60, home * 3);
      // Preserve orbit direction and target while resizing, but fit the new aspect.
      if (previousHome.current !== home) {
        const offset = camera.position.clone().sub(controls.target);
        const scale = initialCameraScale(
          aspectRef.current,
          model.files.length,
          model.groups.length,
        );
        if (scale !== previousScale.current) {
          controls.target.set(
            layout.center[0] + (scale < 1 ? layout.radius * 0.12 : 0),
            layout.center[1] + 1.2,
            layout.center[2],
          );
          camera.position
            .copy(controls.target)
            .addScaledVector(offset.normalize(), home * scale);
        } else {
          camera.position
            .copy(controls.target)
            .addScaledVector(offset, home / previousHome.current);
        }
        previousScale.current = scale;
        controls.update();
        invalidate();
      }
    }
    previousHome.current = home;
  }, [camera, home, invalidate, layout, model.files.length]);
  useEffect(() => {
    const controls = controlsRef.current;
    if (!controls) return;
    const direction =
      cameraCommand === "fit"
        ? camera.position.clone().sub(controls.target).normalize()
        : new Vector3(...HOME_DIRECTION);
    if (!Number.isFinite(direction.lengthSq()) || direction.lengthSq() < 0.01)
      direction.set(...HOME_DIRECTION);
    const scale = initialCameraScale(
      aspectRef.current,
      model.files.length,
      model.groups.length,
    );
    const center = new Vector3(
      layout.center[0] +
        (cameraCommand === "fit" || scale >= 1 ? 0 : layout.radius * 0.12),
      layout.center[1] + 2.4,
      layout.center[2],
    );
    controls.target.copy(center);
    camera.position
      .copy(center)
      .addScaledVector(
        direction,
        cameraCommand === "fit"
          ? homeDistance(
              fitPoints,
              [center.x, center.y, center.z],
              aspectRef.current,
              [direction.x, direction.y, direction.z],
            ) * 1.05
          : homeRef.current * scale,
      );
    controls.update();
    camera.updateProjectionMatrix();
    invalidate();
  }, [
    camera,
    invalidate,
    layout,
    fitPoints,
    model.files.length,
    resetToken,
    cameraCommand,
  ]);
  useEffect(() => {
    if (orbitToken === previousOrbitToken.current || !controlsRef.current)
      return;
    previousOrbitToken.current = orbitToken;
    const controls = controlsRef.current;
    const offset = camera.position.clone().sub(controls.target);
    offset.applyAxisAngle(new Vector3(0, 1, 0), Math.PI / 4);
    camera.position.copy(controls.target).add(offset);
    controls.update();
    invalidate();
  }, [camera, invalidate, orbitToken]);
  useEffect(() => {
    if (!focusId && !focusModule) return;
    const ids = focusId
      ? [
          focusId,
          ...(model.outgoing.get(focusId) ?? []).flatMap((edge) =>
            edge.to ? [edge.to] : [],
          ),
          ...(model.incoming.get(focusId) ?? []).map((edge) => edge.from),
        ]
      : model.files
          .filter((file) => file.path.startsWith(`${focusModule}/`))
          .map((file) => file.id);
    const points = ids
      .map((id) => layout.positions.get(id))
      .filter((point): point is Point => !!point);
    if (!points.length) return;
    const unit = Math.min(1.25, Math.max(0.85, layout.radius / 55));
    const bounds: Point[] = [
      ...points,
      ...ids.flatMap((id) => {
        const point = layout.positions.get(id);
        const file = model.files.find((entry) => entry.id === id);
        return point && file
          ? [
              [
                point[0],
                point[1] + dimensions(file, unit).height + 1,
                point[2],
              ] as Point,
            ]
          : [];
      }),
    ];
    const center = [0, 1, 2].map(
      (axis) =>
        (Math.min(...bounds.map((point) => point[axis])) +
          Math.max(...bounds.map((point) => point[axis]))) /
        2,
    ) as Point;
    const controls = controlsRef.current;
    if (!controls) return;
    const direction = camera.position.clone().sub(controls.target).normalize();
    const distance = Math.max(
      model.files.length > 80 ? 23 : 11,
      homeDistance(bounds, center, aspectRef.current, [
        direction.x,
        direction.y,
        direction.z,
      ]) * 1.15,
    );
    controls.target.set(...center);
    camera.position.set(...center).addScaledVector(direction, distance);
    controls.update();
    camera.updateProjectionMatrix();
    invalidate();
  }, [camera, focusId, focusModule, focusToken, invalidate, layout, model]);
  return null;
}
function ContextWatcher({ onUnavailable }: Pick<Props, "onUnavailable">) {
  const { gl } = useThree();
  useEffect(() => {
    const lost = (event: Event) => {
      event.preventDefault();
      onUnavailable();
    };
    gl.domElement.addEventListener("webglcontextlost", lost);
    return () => gl.domElement.removeEventListener("webglcontextlost", lost);
  }, [gl, onUnavailable]);
  return null;
}

function FileLabels({
  model,
  layout,
  selectedId,
  related,
  showAllLabels,
  onSelect,
  onHover,
}: Pick<
  Props,
  "model" | "layout" | "selectedId" | "showAllLabels" | "onSelect" | "onHover"
> & { related: Set<string> }) {
  const { camera, size } = useThree();
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const names = useMemo(() => shortFileLabels(model.files), [model]);
  const firstInGroup = new Set(
    model.groups.flatMap((group) =>
      group.files
        .filter(
          (_, index) =>
            index % Math.max(1, Math.ceil(group.files.length / 4)) === 0,
        )
        .map((file) => file.id),
    ),
  );
  useFrame(() => {
    const distance = camera.position.distanceTo(new Vector3(...layout.center));
    const candidates = model.files.flatMap((file) => {
      const position = layout.positions.get(file.id);
      if (!position) return [];
      const unit = Math.min(1.25, Math.max(0.85, layout.radius / 55));
      const projected = new Vector3(
        position[0],
        position[1] + dimensions(file, unit).height + 0.9,
        position[2],
      ).project(camera);
      if (projected.z < -1 || projected.z > 1) return [];
      const priority =
        file.id === selectedId
          ? 4
          : related.has(file.id)
            ? 3
            : firstInGroup.has(file.id)
              ? size.width <= 400
                ? 0
                : 2
              : distance < layout.radius * 0.85
                ? size.width <= 400
                  ? 0
                  : 1
                : 0;
      return [
        {
          id: file.id,
          x: ((projected.x + 1) * size.width) / 2,
          y: ((1 - projected.y) * size.height) / 2,
          priority,
        },
      ];
    });
    const visible = visibleLabelIds(
      candidates,
      size.width,
      size.height,
      showAllLabels,
    );
    for (const [id, button] of buttons.current)
      button.style.visibility = visible.has(id) ? "visible" : "hidden";
  });
  return (
    <>
      {model.files.map((file) => {
        const point = layout.positions.get(file.id);
        if (!point) return null;
        return (
          <Html
            key={file.id}
            position={[
              point[0],
              point[1] +
                dimensions(
                  file,
                  Math.min(1.25, Math.max(0.85, layout.radius / 55)),
                ).height +
                0.9,
              point[2],
            ]}
            center
            style={{ pointerEvents: "none" }}
          >
            <button
              ref={(element) => {
                if (element) buttons.current.set(file.id, element);
                else buttons.current.delete(file.id);
              }}
              type="button"
              style={{ visibility: "hidden", pointerEvents: "auto" }}
              className={`graph-node-label ${selectedId === file.id ? "selected" : ""}`}
              title={file.path}
              aria-label={file.path}
              onMouseEnter={() => onHover(file.path)}
              onMouseLeave={() => onHover("")}
              onFocus={() => onHover(file.path)}
              onBlur={() => onHover("")}
              onClick={() => onSelect(file.id)}
            >
              {names.get(file.id)}
            </button>
          </Html>
        );
      })}
    </>
  );
}

function SpatialGraph({
  model,
  layout,
  selectedId,
  onSelect,
  onHover,
  showAllLabels,
  focusId,
  focusModule,
  focusToken,
  resetToken,
  orbitToken,
  cameraCommand,
}: Omit<Props, "onUnavailable">) {
  const related = new Set<string>(
    selectedId
      ? [
          selectedId,
          ...(model.incoming.get(selectedId) ?? []).map((edge) => edge.from),
          ...(model.outgoing.get(selectedId) ?? []).flatMap((edge) =>
            edge.to ? [edge.to] : [],
          ),
        ]
      : [],
  );
  const uses = new Set(
    (selectedId ? (model.outgoing.get(selectedId) ?? []) : []).flatMap(
      (edge) => (edge.to ? [edge.to] : []),
    ),
  );
  const usedBy = new Set(
    (selectedId ? (model.incoming.get(selectedId) ?? []) : []).map(
      (edge) => edge.from,
    ),
  );
  const nodeSize = Math.min(1.25, Math.max(0.85, layout.radius / 55));
  const colors = new Map(
    model.groups.map((group) => [group.path, group.color]),
  );
  const accents = useMemo(() => {
    const result = new Map<string, MeshBasicMaterial>();
    for (const color of [
      ...new Set([
        ...model.groups.map((group) => group.color),
        "#f4ce8b",
        "#f1c78c",
        "#82bde1",
        "#b47670",
      ]),
    ])
      for (const state of ["bright", "dim"])
        result.set(
          `${color}:${state}`,
          new MeshBasicMaterial({
            color,
            transparent: true,
            opacity: state === "bright" ? 0.92 : 0.16,
            depthWrite: false,
          }),
        );
    return result;
  }, [model]);
  useEffect(
    () => () => {
      for (const material of accents.values()) material.dispose();
    },
    [accents],
  );
  return (
    <>
      <CameraRig
        model={model}
        layout={layout}
        focusId={focusId}
        focusModule={focusModule}
        focusToken={focusToken}
        resetToken={resetToken}
        orbitToken={orbitToken}
        cameraCommand={cameraCommand}
      />
      <ambientLight intensity={0.9} />
      <directionalLight
        position={[18, 22, 30]}
        intensity={2.8}
        color="#f4d8a8"
      />
      <directionalLight
        position={[-28, -12, -20]}
        intensity={1.6}
        color="#78a9c6"
      />

      {layout.zones
        .filter(
          (zone) =>
            !layout.zones.some((child) =>
              child.path.startsWith(`${zone.path}/`),
            ),
        )
        .slice(0, 16)
        .map((zone) => {
          const count = model.files.filter((file) =>
            file.path.startsWith(`${zone.path}/`),
          ).length;
          return (
            <group key={zone.path} position={zone.position}>
              <Html
                position={[0, 9, 0]}
                center
                style={{
                  pointerEvents: "none",
                  visibility:
                    selectedId || model.files.length > 80
                      ? "hidden"
                      : "visible",
                }}
              >
                <span className="graph-zone-label" title={zone.path}>
                  {zone.path}
                  <small>{count} files</small>
                </span>
              </Html>
            </group>
          );
        })}
      {layout.groups.map((group) => {
        const points =
          model.groups
            .find((entry) => entry.path === group.path)
            ?.files.map((file) => layout.positions.get(file.id))
            .filter((point): point is Point => !!point) ?? [];
        if (!points.length) return null;
        const minX = Math.min(...points.map((point) => point[0]));
        const maxX = Math.max(...points.map((point) => point[0]));
        const minZ = Math.min(...points.map((point) => point[2]));
        const maxZ = Math.max(...points.map((point) => point[2]));
        const x = (minX + maxX) / 2,
          z = (minZ + maxZ) / 2;
        const width = maxX - minX + 3.5,
          depth = maxZ - minZ + 3.6;
        const base = Math.min(...points.map((point) => point[1])) - 0.42;
        const trim = accents.get(`${group.color}:bright`)!;
        return (
          <group key={group.path}>
            <Beam
              position={[x, base - 0.18, z]}
              scale={[width, 0.35, depth]}
              material={floor}
            />
            <Beam
              position={[x, base + 0.04, z]}
              scale={[width, 0.08, depth]}
              material={darkMetal}
            />
            {[-1, 1].map((side) => (
              <group key={side}>
                <Beam
                  position={[x, base + 0.12, z + (side * depth) / 2]}
                  scale={[width, 0.05, 0.045]}
                  material={trim}
                />
                <Beam
                  position={[x + (side * width) / 2, base + 0.12, z]}
                  scale={[0.045, 0.05, depth]}
                  material={trim}
                />
              </group>
            ))}
            {layout.groups.length <= 6 &&
              !layout.zones.some(
                (zone) =>
                  group.path === zone.path ||
                  group.path.startsWith(`${zone.path}/`),
              ) && (
                <Html
                  position={[x, base + 8.5, z]}
                  center
                  style={{
                    pointerEvents: "none",
                    visibility: selectedId ? "hidden" : "visible",
                  }}
                >
                  <span className="graph-group-label" title={group.path}>
                    {group.path === "." ? "root" : group.path}
                  </span>
                </Html>
              )}
          </group>
        );
      })}
      {model.connections.map((connection) => {
        const a = layout.positions.get(connection.from),
          b = layout.positions.get(connection.to);
        if (!a || !b) return null;
        if (Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) < 0.001)
          return null;
        const source = model.files.find((file) => file.id === connection.from)!;
        const target = model.files.find((file) => file.id === connection.to)!;
        const points = dependencyArc(
          [a[0], a[1] + dimensions(source, nodeSize).height + 0.4, a[2]],
          [b[0], b[1] + dimensions(target, nodeSize).height + 0.4, b[2]],
        );
        const crossDirectory = source.parent !== target.parent;
        const emphasized =
          !selectedId ||
          connection.from === selectedId ||
          connection.to === selectedId;
        const color = !selectedId
          ? crossDirectory
            ? "#d2b68c"
            : (colors.get(source.parent) ?? "#9bafbb")
          : connection.from === selectedId
            ? "#f1c78c"
            : connection.to === selectedId
              ? "#82bde1"
              : "#584e4b";
        const arrow = new Vector3(...points[14]);
        const rotation = new Quaternion().setFromUnitVectors(
          new Vector3(0, 1, 0),
          new Vector3(...points[15])
            .sub(new Vector3(...points[13]))
            .normalize(),
        );
        return (
          <group key={`${connection.from}:${connection.to}:${connection.kind}`}>
            {emphasized && (
              <Line
                points={points}
                color={color}
                lineWidth={selectedId ? 8 : crossDirectory ? 5 : 3.5}
                transparent
                opacity={selectedId ? 0.24 : crossDirectory ? 0.16 : 0.1}
              />
            )}
            <Line
              points={points}
              color={color}
              lineWidth={
                selectedId && emphasized ? 2.8 : crossDirectory ? 1.8 : 1.35
              }
              transparent
              opacity={
                selectedId && emphasized ? 0.98 : emphasized ? 0.7 : 0.08
              }
            />
            {emphasized && (selectedId || crossDirectory) && (
              <mesh position={arrow} quaternion={rotation}>
                <coneGeometry
                  args={[
                    nodeSize * (selectedId ? 0.19 : 0.11),
                    nodeSize * (selectedId ? 0.5 : 0.3),
                    5,
                  ]}
                />
                <meshBasicMaterial color={color} />
              </mesh>
            )}
          </group>
        );
      })}
      {model.files.map((file) => {
        const position = layout.positions.get(file.id);
        if (!position) return null;
        const selected = file.id === selectedId,
          active = !selectedId || related.has(file.id);
        const color = selected
          ? "#f4ce8b"
          : uses.has(file.id)
            ? "#f1c78c"
            : usedBy.has(file.id)
              ? "#82bde1"
              : file.status === "failed"
                ? "#b47670"
                : (colors.get(file.parent) ?? "#ba9a72");
        const accent = accents.get(`${color}:${active ? "bright" : "dim"}`)!;
        return (
          <group
            key={file.id}
            position={position}
            onClick={(event) => {
              event.stopPropagation();
              onSelect(file.id);
            }}
            onPointerOver={(event) => {
              event.stopPropagation();
              document.body.style.cursor = "pointer";
              onHover(file.path);
            }}
            onPointerOut={() => {
              document.body.style.cursor = "";
              onHover("");
            }}
          >
            <FileBuilding
              file={file}
              unit={nodeSize}
              accent={accent}
              active={active}
              selected={selected}
              highlighted={!!selectedId && active}
              detailed={model.files.length <= 80}
            />
          </group>
        );
      })}
      <FileLabels
        model={model}
        layout={layout}
        selectedId={selectedId}
        related={related}
        showAllLabels={showAllLabels}
        onSelect={onSelect}
        onHover={onHover}
      />
    </>
  );
}

export function GraphScene3D(props: Props) {
  const { onUnavailable, layout } = props;
  useEffect(
    () => () => {
      document.body.style.cursor = "";
    },
    [],
  );
  return (
    <SceneBoundary onUnavailable={onUnavailable}>
      <Canvas
        className="graph-canvas"
        frameloop="demand"
        dpr={[1, 1.5]}
        camera={{
          fov: 55,
          near: 0.1,
          far: Math.max(500, layout.radius * 12),
          position: [12, 10, 16],
        }}
      >
        <color attach="background" args={["#07090c"]} />
        <ContextWatcher onUnavailable={onUnavailable} />
        <SpatialGraph {...props} />
      </Canvas>
    </SceneBoundary>
  );
}
