import { Component, useEffect, useMemo, useRef, type ReactNode } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Html, Line } from "@react-three/drei";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { Quaternion, Vector3 } from "three";
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
      ...[...layout.positions.values()].map(
        ([x, y, z]) =>
          [
            x,
            y + Math.min(1.25, Math.max(0.85, layout.radius / 55)) * 8.2,
            z,
          ] as Point,
      ),
      ...layout.groups.map((group) => group.position),
    ],
    [layout],
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
      layout.zones.length,
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
          layout.zones.length,
        );
        if (scale !== previousScale.current) {
          controls.target.set(
            layout.center[0] + (scale === 0.66 ? layout.radius * 0.3 : 0),
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
      layout.zones.length,
    );
    const center = new Vector3(
      layout.center[0] +
        (scale !== 0.66 || cameraCommand === "fit" ? 0 : layout.radius * 0.3),
      layout.center[1] + 1.2,
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
    const height = Math.min(1.25, Math.max(0.85, layout.radius / 55)) * 8.2;
    const bounds: Point[] = [
      ...points,
      ...points.map(([x, y, z]): Point => [x, y + height, z]),
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
      9,
      homeDistance(bounds, center, aspectRef.current, [
        direction.x,
        direction.y,
        direction.z,
      ]) * 0.85,
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
      const projected = new Vector3(...position).project(camera);
      if (projected.z < -1 || projected.z > 1) return [];
      const priority =
        file.id === selectedId
          ? 4
          : related.has(file.id)
            ? 3
            : firstInGroup.has(file.id)
              ? 2
              : distance < layout.radius * 0.85
                ? 1
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
            position={[point[0], point[1] + 0.7, point[2]]}
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
  const nodeSize = Math.min(1.25, Math.max(0.85, layout.radius / 55));
  const colors = new Map(
    model.groups.map((group) => [group.path, group.color]),
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
      <ambientLight intensity={0.8} />
      <directionalLight
        position={[18, 22, 30]}
        intensity={2.4}
        color="#f4d8a8"
      />
      <directionalLight
        position={[-28, -12, -20]}
        intensity={1.3}
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
              {!selectedId && (
                <mesh rotation={[-Math.PI / 2, 0, 0]}>
                  <ringGeometry
                    args={[
                      Math.min(6, Math.max(3, zone.radius * 0.4)),
                      Math.min(6, Math.max(3, zone.radius * 0.4)) + 0.03,
                      48,
                    ]}
                  />
                  <meshBasicMaterial
                    color={zone.color}
                    transparent
                    opacity={0.25}
                    depthWrite={false}
                    side={2}
                  />
                </mesh>
              )}
              {!selectedId && (
                <Html
                  position={[0, zone.radius * 0.38, 0]}
                  center
                  style={{ pointerEvents: "none" }}
                >
                  <span className="graph-zone-label" title={zone.path}>
                    {zone.path}
                    <small>{count} files</small>
                  </span>
                </Html>
              )}
            </group>
          );
        })}
      {layout.groups.map((group) => (
        <group key={group.path} position={group.position}>
          {!selectedId &&
            layout.groups.length <= 28 &&
            !layout.zones.some(
              (zone) =>
                group.path === zone.path ||
                group.path.startsWith(`${zone.path}/`),
            ) && (
              <Html
                position={[0, 3.1, 0]}
                center
                style={{ pointerEvents: "none" }}
              >
                <span className="graph-group-label" title={group.path}>
                  {group.path === "." ? "root" : group.path}
                </span>
              </Html>
            )}
        </group>
      ))}
      {model.connections.map((connection) => {
        const a = layout.positions.get(connection.from),
          b = layout.positions.get(connection.to);
        if (!a || !b) return null;
        if (Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) < 0.001)
          return null;
        const points = dependencyArc(
          [a[0], a[1] + nodeSize * 1.7, a[2]],
          [b[0], b[1] + nodeSize * 1.7, b[2]],
        );
        const emphasized =
          !selectedId ||
          connection.from === selectedId ||
          connection.to === selectedId;
        const color = !selectedId
          ? "#977f68"
          : connection.from === selectedId
            ? "#f1c78c"
            : connection.to === selectedId
              ? "#82bde1"
              : "#584e4b";
        const arrow = new Vector3(...points[13]);
        const rotation = new Quaternion().setFromUnitVectors(
          new Vector3(0, 1, 0),
          new Vector3(...points[14])
            .sub(new Vector3(...points[12]))
            .normalize(),
        );
        return (
          <group key={`${connection.from}:${connection.to}:${connection.kind}`}>
            {selectedId && emphasized && (
              <Line
                points={points}
                color={color}
                lineWidth={6}
                transparent
                opacity={0.14}
              />
            )}
            <Line
              points={points}
              color={color}
              lineWidth={
                selectedId && emphasized ? 2.7 : emphasized ? 1.1 : 0.65
              }
              transparent
              opacity={
                selectedId && emphasized ? 0.95 : emphasized ? 0.34 : 0.08
              }
            />
            {selectedId && emphasized && (
              <mesh position={arrow} quaternion={rotation}>
                <coneGeometry args={[nodeSize * 0.21, nodeSize * 0.58, 5]} />
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
          : file.status === "failed"
            ? "#b47670"
            : (colors.get(file.parent) ?? "#ba9a72");
        // Path length adds visual rhythm only; it is not a complexity metric.
        const height =
          nodeSize * (selected ? 8.2 : 5.1 + (file.path.length % 4) * 0.8);
        const width = nodeSize * (selected ? 0.78 : 0.64);
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
            <mesh>
              <boxGeometry args={[width, height, width]} />
              <meshStandardMaterial
                color={selected ? "#654b33" : "#17212a"}
                emissive={color}
                emissiveIntensity={selected ? 0.85 : active ? 0.3 : 0.03}
                transparent
                opacity={active ? 0.86 : 0.23}
                roughness={0.18}
                metalness={0.72}
              />
            </mesh>
            <mesh>
              <boxGeometry args={[width * 1.12, height * 1.02, width * 1.12]} />
              <meshBasicMaterial
                color={color}
                wireframe
                transparent
                opacity={selected ? 0.95 : active ? 0.68 : 0.08}
                depthWrite={false}
              />
            </mesh>
            <mesh position={[0, height * 0.16, 0]}>
              <boxGeometry
                args={[nodeSize * 0.12, height * 0.75, nodeSize * 0.12]}
              />
              <meshBasicMaterial
                color={selected ? "#ffe2a8" : color}
                transparent
                opacity={active ? 0.8 : 0.08}
              />
            </mesh>
            <mesh position={[0, height * 0.3, 0]}>
              <boxGeometry args={[width * 1.18, 0.09, width * 1.18]} />
              <meshBasicMaterial
                color={color}
                transparent
                opacity={active ? 0.75 : 0.1}
              />
            </mesh>
            <mesh position={[0, height / 2 + 0.08, 0]}>
              <boxGeometry args={[width * 1.55, 0.15, width * 1.55]} />
              <meshStandardMaterial
                color={selected ? "#ffe2ae" : "#b8b9b2"}
                emissive={color}
                emissiveIntensity={active ? 1.25 : 0.1}
                metalness={0.62}
                roughness={0.16}
                transparent
                opacity={active ? 0.95 : 0.2}
              />
            </mesh>
            {selected && (
              <>
                <mesh
                  rotation={[-Math.PI / 2, 0, 0]}
                  position={[0, -height / 2 - 0.08, 0]}
                >
                  <ringGeometry args={[nodeSize * 0.95, nodeSize * 1.2, 32]} />
                  <meshBasicMaterial
                    color="#f3d4a0"
                    transparent
                    opacity={0.78}
                    side={2}
                  />
                </mesh>
                <pointLight
                  position={[0, height * 0.4, 0]}
                  color="#ffd69d"
                  intensity={2.5}
                  distance={11}
                  decay={2}
                />
              </>
            )}
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
