import { useEffect, useRef } from 'react';
import { fitStart } from '../games/start';
import type { Alliance, Area, BoxElement, GameDefinition } from '../games/types';
import { outlineOf } from '../robots/chassis';
import { fitsUnder } from '../robots/stats';
import type { RobotDefinition } from '../robots/types';
import { keyLabel } from '../settings';
import { useGame, type StartPose } from './store';

interface Props {
  game: GameDefinition;
  robot: RobotDefinition;
  alliance: Alliance;
  /** Null means the game's usual starting spot. */
  value: StartPose | null;
  onChange: (pose: StartPose | null) => void;
}

/** Radians per second the robot turns while a turn key is held. */
const TURN_RATE = 2.2;

/**
 * The whole field seen from above, red on the left as on the official
 * drawings. Drag the robot's outline to choose where it starts the match and
 * hold the turn keys to turn it. It can go anywhere in its alliance zone,
 * and under the trench bars if the robot fits under them.
 */
export function FieldMap({ game, robot, alliance, value, onChange }: Props) {
  const svg = useRef<SVGSVGElement>(null);
  const dragging = useRef(false);
  const keys = useGame((state) => state.settings.keys);
  const { length, width } = game.field;
  const usual = game.spawns.find((spawn) => spawn.alliance === alliance) ?? game.spawns[0];
  const pose: StartPose = value ?? { x: usual.x, z: usual.z, yaw: usual.yaw };

  const outline = outlineOf(robot.chassis);
  const halfX = (outline.front + outline.back) / 2;
  const halfZ = (outline.left + outline.right) / 2;
  const underBars = fitsUnder(robot, game.field.lowBarClearance ?? 0);
  const areas: Area[] = game.startAreas?.(alliance, underBars) ?? [
    { minX: -length / 2, maxX: length / 2, minZ: -width / 2, maxZ: width / 2 },
  ];

  // Screen position of a field point: the picture is the field turned half a turn, so red is on the left.
  const sx = (x: number) => length / 2 - x;
  const sy = (z: number) => width / 2 - z;

  const startZone = game.startZone?.(alliance) ?? null;

  /** The nearest allowed spot to a point: on floor it may stand on, and touching its alliance zone. */
  const allowed = (x: number, z: number, yaw: number): StartPose =>
    fitStart(areas, startZone, { x: halfX, z: halfZ }, { x, z, yaw }) ?? { x: pose.x, z: pose.z, yaw };

  const moveTo = (clientX: number, clientY: number) => {
    const box = svg.current?.getBoundingClientRect();
    if (!box || box.width === 0) return;
    const x = length / 2 - ((clientX - box.left) / box.width) * length;
    const z = width / 2 - ((clientY - box.top) / box.height) * width;
    onChange(allowed(x, z, pose.yaw));
  };

  // Holding a turn key turns the robot smoothly. The latest pose is read from a ref so the loop is set up once.
  const latest = useRef({ pose, allowed, onChange });
  latest.current = { pose, allowed, onChange };
  useEffect(() => {
    const held = new Set<string>();
    let frame = 0;
    let last = 0;
    const tick = (now: number) => {
      const dt = last ? Math.min(0.05, (now - last) / 1000) : 0;
      last = now;
      const direction = (held.has(keys.turnLeft) ? 1 : 0) - (held.has(keys.turnRight) ? 1 : 0);
      if (direction !== 0 && dt > 0) {
        const { pose: current, allowed: fit, onChange: change } = latest.current;
        change(fit(current.x, current.z, current.yaw + direction * TURN_RATE * dt));
      }
      frame = held.size > 0 ? requestAnimationFrame(tick) : 0;
    };
    const down = (event: KeyboardEvent) => {
      if (event.code !== keys.turnLeft && event.code !== keys.turnRight) return;
      if (event.target instanceof HTMLInputElement) return;
      event.preventDefault();
      held.add(event.code);
      if (!frame) {
        last = 0;
        frame = requestAnimationFrame(tick);
      }
    };
    const up = (event: KeyboardEvent) => held.delete(event.code);
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      cancelAnimationFrame(frame);
    };
  }, [keys.turnLeft, keys.turnRight]);

  // The robot's corners and the tip of its front arrow, in field coordinates.
  const cos = Math.cos(pose.yaw);
  const sin = Math.sin(pose.yaw);
  const point = (lx: number, lz: number) => `${sx(pose.x + lx * cos + lz * sin)},${sy(pose.z - lx * sin + lz * cos)}`;
  const body = [point(halfX, -halfZ), point(halfX, halfZ), point(-halfX, halfZ), point(-halfX, -halfZ)].join(' ');
  const arrow = [point(halfX + 0.28, 0), point(halfX + 0.02, -0.16), point(halfX + 0.02, 0.16)].join(' ');
  const zone = game.field.zoneDepth ?? 0;

  return (
    <div className="field-map">
      <svg
        ref={svg}
        viewBox={`0 0 ${length} ${width}`}
        role="img"
        aria-label="The field from above. Drag your robot to set where it starts."
        onPointerDown={(event) => {
          dragging.current = true;
          event.currentTarget.setPointerCapture(event.pointerId);
          moveTo(event.clientX, event.clientY);
        }}
        onPointerMove={(event) => {
          if (dragging.current) moveTo(event.clientX, event.clientY);
        }}
        onPointerUp={() => (dragging.current = false)}
        onPointerCancel={() => (dragging.current = false)}
      >
        <rect className="carpet" x={0} y={0} width={length} height={width} />
        {zone > 0 && (
          <>
            <rect className={`zone red${alliance === 'red' ? ' mine' : ''}`} x={0} y={0} width={zone} height={width} />
            <rect
              className={`zone blue${alliance === 'blue' ? ' mine' : ''}`}
              x={length - zone}
              y={0}
              width={zone}
              height={width}
            />
          </>
        )}
        <line className="centre" x1={length / 2} y1={0} x2={length / 2} y2={width} />
        {game.statics.map((element, i) => {
          const shape = footprint(element);
          if (!shape) return null;
          return (
            <rect
              key={i}
              className={`element ${element.position[0] > 0 ? 'red' : 'blue'}`}
              x={sx(element.position[0]) - shape.sizeX / 2}
              y={sy(element.position[2]) - shape.sizeZ / 2}
              width={shape.sizeX}
              height={shape.sizeZ}
            />
          );
        })}
        <polygon className="robot" points={body} />
        <polygon className="robot-front" points={arrow} />
      </svg>
      <div className="field-map-foot">
        <span className="hint">
          Drag to place your robot. Hold {keyLabel(keys.turnLeft)} or {keyLabel(keys.turnRight)} to turn it.
          {startZone
            ? underBars
              ? ' It must touch your alliance zone; it fits under the trench, so it may start there with a bumper on the line.'
              : ' It must touch your alliance zone.'
            : ''}
        </span>
        <button className="small" disabled={value === null} onClick={() => onChange(null)}>
          Reset
        </button>
      </div>
    </div>
  );
}

/** How much floor an element covers, for elements that are upright or only tilted along the field's length. */
function footprint(element: BoxElement): { sizeX: number; sizeZ: number } | null {
  const [rx, ry, rz] = element.rotation ?? [0, 0, 0];
  if (rx !== 0 || ry !== 0) return null;
  // Thin panels standing high above the carpet (nets, light bars) would only clutter the map.
  if (element.position[1] - element.size[1] / 2 > 1.2) return null;
  return { sizeX: Math.max(0.03, element.size[0] * Math.abs(Math.cos(rz))), sizeZ: Math.max(0.03, element.size[2]) };
}
