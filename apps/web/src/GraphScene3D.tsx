import { Component, useEffect, useMemo, useRef, type ReactNode } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Html, Line } from "@react-three/drei";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { Quaternion, Vector3 } from "three";
import { shortFileLabels, visibleLabelIds } from "./graphLabels";
import {
  HOME_DIRECTION,
  homeDistance,
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
  const home = useMemo(
    () =>
      homeDistance(
        [
          ...layout.positions.values(),
          ...layout.groups.map((group) => group.position),
        ],
        layout.center,
        size.width / size.height,
      ),
    [layout, size.width, size.height],
  );
  const homeRef = useRef(home);
  homeRef.current = home;
  const previousHome = useRef(home);
  const previousOrbitToken = useRef(orbitToken);
  const aspectRef = useRef(size.width / size.height);
  aspectRef.current = size.width / size.height;
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
        camera.position
          .copy(controls.target)
          .addScaledVector(offset, home / previousHome.current);
        controls.update();
        invalidate();
      }
    }
    previousHome.current = home;
  }, [camera, home, invalidate]);
  useEffect(() => {
    const controls = controlsRef.current;
    if (!controls) return;
    const direction =
      cameraCommand === "fit"
        ? camera.position.clone().sub(controls.target).normalize()
        : new Vector3(...HOME_DIRECTION);
    if (!Number.isFinite(direction.lengthSq()) || direction.lengthSq() < 0.01)
      direction.set(...HOME_DIRECTION);
    const compact = aspectRef.current < 0.85;
    const center =
      cameraCommand === "reset"
        ? new Vector3(
            layout.center[0] + (compact ? 0 : layout.radius * 0.19),
            layout.center[1],
            layout.center[2],
          )
        : new Vector3(...layout.center);
    controls.target.copy(center);
    camera.position
      .copy(center)
      .addScaledVector(
        direction,
        cameraCommand === "reset" && !compact
          ? homeRef.current * 0.76
          : homeRef.current,
      );
    controls.update();
    camera.updateProjectionMatrix();
    invalidate();
  }, [camera, invalidate, layout, resetToken, cameraCommand]);
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
    const center = [0, 1, 2].map(
      (axis) =>
        (Math.min(...points.map((point) => point[axis])) +
          Math.max(...points.map((point) => point[axis]))) /
        2,
    ) as Point;
    const distance = Math.max(
      9,
      homeDistance(points, center, aspectRef.current) * 1.25,
    );
    const controls = controlsRef.current;
    if (!controls) return;
    const direction = camera.position.clone().sub(controls.target).normalize();
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
      <ambientLight intensity={1.45} />
      <directionalLight
        position={[18, 22, 30]}
        intensity={2.8}
        color="#f4d8a8"
      />
      <directionalLight
        position={[-28, -12, -20]}
        intensity={1.4}
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
          <mesh position={[0, -2.4, 0]}>
            <boxGeometry
              args={[
                Math.min(
                  10,
                  3 +
                    (model.groups.find((item) => item.path === group.path)
                      ?.files.length ?? 0) *
                      0.8,
                ),
                0.1,
                3.7,
              ]}
            />
            <meshBasicMaterial
              color={group.color}
              transparent
              opacity={0.13}
              depthWrite={false}
            />
          </mesh>
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
        const start = new Vector3(...a),
          end = new Vector3(...b);
        const direction = new Vector3().subVectors(end, start);
        if (direction.lengthSq() < 0.001) return null;
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
        const arrow = start.clone().lerp(end, 0.79);
        const rotation = new Quaternion().setFromUnitVectors(
          new Vector3(0, 1, 0),
          direction.normalize(),
        );
        return (
          <group key={`${connection.from}:${connection.to}:${connection.kind}`}>
            <Line
              points={[a, b]}
              color={color}
              lineWidth={emphasized ? 1.8 : 0.65}
              transparent
              opacity={emphasized ? 0.76 : 0.15}
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
        const color =
          file.status === "failed"
            ? "#b47670"
            : (colors.get(file.parent) ?? "#ba9a72");
        const height = selected
          ? nodeSize * 3.4
          : nodeSize * (2.3 + (file.path.length % 3) * 0.4);
        return (
          <group key={file.id} position={position}>
            <mesh
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
              <boxGeometry args={[nodeSize * 0.95, height, nodeSize * 0.95]} />
              <meshStandardMaterial
                color={color}
                emissive={color}
                emissiveIntensity={selected ? 1.4 : active ? 0.6 : 0.1}
                transparent
                opacity={active ? 0.92 : 0.34}
                roughness={0.35}
                metalness={0.42}
              />
            </mesh>
            <mesh position={[0, height / 2 + 0.08, 0]}>
              <boxGeometry args={[nodeSize * 1.18, 0.12, nodeSize * 1.18]} />
              <meshBasicMaterial
                color={selected ? "#ffdfab" : color}
                transparent
                opacity={active ? 1 : 0.3}
              />
            </mesh>
            {selected && (
              <mesh position={[0, -height / 2 - 0.08, 0]}>
                <boxGeometry args={[nodeSize * 1.6, 0.12, nodeSize * 1.6]} />
                <meshBasicMaterial color="#f3d4a0" />
              </mesh>
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
