import { Component, useEffect, useMemo, useRef, type ReactNode } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { Html, Line } from "@react-three/drei";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { Quaternion, Vector3 } from "three";
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
  showAllLabels: boolean;
  focusId: string | null;
  focusToken: number;
  resetToken: number;

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
  focusToken,
  resetToken,
}: Pick<Props, "model" | "layout" | "focusId" | "focusToken" | "resetToken">) {
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
  useEffect(() => {
    const controls = new OrbitControls(camera, gl.domElement);
    controlsRef.current = controls;
    controls.enableDamping = false;
    controls.enablePan = true;
    controls.minDistance = 2;
    controls.maxDistance = Math.max(60, home * 3);
    const changed = () => invalidate();
    controls.addEventListener("change", changed);
    return () => {
      controls.removeEventListener("change", changed);
      controls.dispose();
      controlsRef.current = null;
    };
  }, [camera, gl, home, invalidate]);
  useEffect(() => {
    const [x, y, z] = layout.center;
    controlsRef.current?.target.set(x, y, z);
    camera.position.set(
      x + home * HOME_DIRECTION[0],
      y + home * HOME_DIRECTION[1],
      z + home * HOME_DIRECTION[2],
    );
    controlsRef.current?.update();
    camera.updateProjectionMatrix();
    invalidate();
  }, [camera, home, invalidate, layout, resetToken]);
  useEffect(() => {
    if (!focusId) return;
    const point = layout.positions.get(focusId);
    if (!point) return;
    const ids = [
      focusId,
      ...(model.outgoing.get(focusId) ?? []).flatMap((edge) =>
        edge.to ? [edge.to] : [],
      ),
      ...(model.incoming.get(focusId) ?? []).map((edge) => edge.from),
    ];
    const points = ids
      .map((id) => layout.positions.get(id))
      .filter((position): position is Point => !!position);
    const center = [0, 1, 2].map(
      (axis) =>
        (Math.min(...points.map((position) => position[axis])) +
          Math.max(...points.map((position) => position[axis]))) /
        2,
    ) as Point;
    const distance = Math.max(
      16,
      homeDistance(points, center, size.width / size.height),
    );
    controlsRef.current?.target.set(...center);
    camera.position.set(
      center[0] + distance * HOME_DIRECTION[0],
      center[1] + distance * HOME_DIRECTION[1],
      center[2] + distance * HOME_DIRECTION[2],
    );
    controlsRef.current?.update();
    camera.updateProjectionMatrix();
    invalidate();
  }, [
    camera,
    focusId,
    focusToken,
    home,
    invalidate,
    layout,
    model,
    size.width,
    size.height,
  ]);
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

function SpatialGraph({
  model,
  layout,
  selectedId,
  onSelect,
  showAllLabels,
  focusId,
  focusToken,
  resetToken,
}: Omit<Props, "onUnavailable">) {
  const related = new Set<string>(
    selectedId
      ? [
          selectedId,
          ...(model.incoming.get(selectedId) ?? []).map((e) => e.from),
          ...(model.outgoing.get(selectedId) ?? [])
            .map((e) => e.to!)
            .filter(Boolean),
        ]
      : [],
  );
  const labels = new Set<string>();
  for (const group of model.groups) {
    if (group.files[0]) labels.add(group.files[0].id);
  }
  for (const file of model.files)
    if (selectedId && related.has(file.id)) labels.add(file.id);
  const visibleLabels = model.files.filter(
    (file) =>
      showAllLabels ||
      (labels.has(file.id) &&
        (labels.size <= 28 ||
          file.id === selectedId ||
          model.files.indexOf(file) < 28)),
  );
  const nodeSize = Math.min(0.9, Math.max(0.3, layout.radius / 80));
  return (
    <>
      <CameraRig
        model={model}
        layout={layout}
        focusId={focusId}
        focusToken={focusToken}
        resetToken={resetToken}
      />
      <ambientLight intensity={1.3} />
      <pointLight position={[18, 24, 28]} intensity={38} color="#e4bb85" />
      {layout.zones.map((zone) => (
        <group key={`zone:${zone.path}`} position={zone.position}>
          {layout.zones.length <= 12 && (
            <Html
              position={[0, 2.5, 0]}
              center
              style={{ pointerEvents: "none" }}
            >
              <span className="graph-zone-label" title={zone.path}>
                {zone.path}
              </span>
            </Html>
          )}
        </group>
      ))}
      {layout.groups.map((group) => (
        <group key={group.path} position={group.position}>
          <mesh>
            <sphereGeometry args={[0.75, 12, 8]} />
            <meshBasicMaterial
              color={group.color}
              transparent
              opacity={0.1}
              wireframe
              depthWrite={false}
            />
          </mesh>
          {layout.groups.length <= 24 && (
            <Html
              position={[0, 2.5, 0]}
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
        const a = layout.positions.get(connection.from);
        const b = layout.positions.get(connection.to);
        if (!a || !b) return null;
        const start = new Vector3(...a),
          end = new Vector3(...b);
        const direction = new Vector3().subVectors(end, start);
        if (direction.lengthSq() < 0.001) return null;
        const emphasized =
          !selectedId ||
          connection.from === selectedId ||
          connection.to === selectedId;
        const outbound = connection.from === selectedId;
        const color = !selectedId
          ? "#aa9075"
          : outbound
            ? "#e1b67d"
            : connection.to === selectedId
              ? "#8db7c8"
              : "#51484c";
        const arrow = start.clone().lerp(end, 0.76);
        const rotation = new Quaternion().setFromUnitVectors(
          new Vector3(0, 1, 0),
          direction.normalize(),
        );
        return (
          <group key={`${connection.from}:${connection.to}:${connection.kind}`}>
            <Line
              points={[a, b]}
              color={color}
              lineWidth={emphasized ? 2.4 : 0.7}
              transparent
              opacity={emphasized ? 0.95 : 0.25}
            />
            <mesh position={arrow} quaternion={rotation}>
              <coneGeometry args={[nodeSize * 0.35, nodeSize, 5]} />
              <meshBasicMaterial
                color={color}
                transparent
                opacity={emphasized ? 0.95 : 0.25}
              />
            </mesh>
          </group>
        );
      })}
      {model.files.map((file) => {
        const position = layout.positions.get(file.id);
        if (!position) return null;
        const selected = file.id === selectedId;
        const active = !selectedId || related.has(file.id);
        const color =
          model.groups.find((group) => group.path === file.parent)?.color ??
          "#ba9a72";
        return (
          <mesh
            key={file.id}
            position={position}
            onClick={(event) => {
              event.stopPropagation();
              onSelect(file.id);
            }}
            onPointerOver={() => {
              document.body.style.cursor = "pointer";
            }}
            onPointerOut={() => {
              document.body.style.cursor = "";
            }}
          >
            <sphereGeometry
              args={[selected ? nodeSize * 1.4 : nodeSize, 12, 12]}
            />
            <meshStandardMaterial
              color={file.status === "failed" ? "#b47670" : color}
              emissive={selected ? "#c8a87b" : color}
              emissiveIntensity={selected ? 1.7 : active ? 0.6 : 0.1}
              transparent
              opacity={active ? 1 : 0.45}
              roughness={0.45}
            />
          </mesh>
        );
      })}
      {visibleLabels.map((file) => {
        const point = layout.positions.get(file.id);
        if (!point) return null;
        return (
          <Html
            key={file.id}
            position={[point[0], point[1] + 0.6, point[2]]}
            center
            style={{ pointerEvents: "auto" }}
          >
            <button
              type="button"
              className={`graph-node-label ${selectedId === file.id ? "selected" : ""}`}
              title={file.path}
              onClick={() => onSelect(file.id)}
            >
              {file.name}
            </button>
          </Html>
        );
      })}
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
        <color attach="background" args={["#08080a"]} />
        <ContextWatcher onUnavailable={onUnavailable} />
        <SpatialGraph {...props} />
      </Canvas>
    </SceneBoundary>
  );
}
