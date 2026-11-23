import { bumperOutline, hasShapedCorners } from '../robots/outline';
import { useEffect, useRef } from 'react';
import { robotStart } from '../games/start';
import type { Alliance, BoxElement, GameDefinition } from '../games/types';
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
  /** Which driver station the robot belongs to; its usual spot lines up with it. */
  station?: number;
  /** Other robots on the field, drawn faintly. */
  others?: { key: string | number; robot: RobotDefinition; alliance: Alliance; pose: StartPose; label: string }[];
  /** False to only show where the robot is. */
  editable?: boolean;
}

/** A robot's outline turned and placed, as SVG polygon points for its body and its front arrow. */
function outlinePoints(robot: RobotDefinition, pose: StartPose, sx: (x: number) => number, sy: (z: number) => number) {
  const outline = outlineOf(robot.chassis);
  const halfX = (outline.front + outline.back) / 2;
  const halfZ = (outline.left + outline.right) / 2;
  const cos = Math.cos(pose.yaw);
  const sin = Math.sin(pose.yaw);
  const point = (lx: number, lz: number) => `${sx(pose.x + lx * cos + lz * sin)},${sy(pose.z - lx * sin + lz * cos)}`;
  // A round robot is drawn as a circle, and one with cut corners as its bumper outline.
  const corners = hasShapedCorners(robot.chassis)
    ? bumperOutline(robot.chassis).map((p) => point(p.x, p.z))
    : robot.chassis.round
    ? Array.from({ length: 24 }, (_, i) => point(halfX * Math.cos((i * Math.PI) / 12), halfX * Math.sin((i * Math.PI) / 12)))
    : [point(halfX, -halfZ), point(halfX, halfZ), point(-halfX, halfZ), point(-halfX, -halfZ)];
  return {
    body: corners.join(' '),
    arrow: [point(halfX + 0.28, 0), point(halfX + 0.02, -0.16), point(halfX + 0.02, 0.16)].join(' '),
  };
}

/** How far each button press turns the robot. */
const TURN_STEP = Math.PI / 4;

/** Radians per second the robot turns while a turn key is held. */
const TURN_RATE = 2.2;

/**
 * The whole field seen from above, red on the left as on the official
 * drawings. Drag the robot's outline to choose where it starts the match and
 * hold the turn keys to turn it. It can go anywhere in its alliance zone,
 * and under the trench bars if the robot fits under them.
 */
export function FieldMap({ game, robot, alliance, value, onChange, station = 1, others = [], editable = true }: Props) {
  const svg = useRef<SVGSVGElement>(null);
  const dragging = useRef(false);
  const keys = useGame((state) => state.settings.keys);
  const { length, width } = game.field;
  const pose: StartPose = robotStart(game, robot, alliance, value, station);
  const underBars = fitsUnder(robot, game.field.lowBarClearance ?? 0);

  // Screen position of a field point: the picture is the field turned half a turn, so red is on the left.
  const sx = (x: number) => length / 2 - x;
  const sy = (z: number) => width / 2 - z;

  const startZone = game.startZone?.(alliance) ?? null;

  /** The nearest allowed spot to a point: on floor it may stand on, and touching its starting line. */
  const allowed = (x: number, z: number, yaw: number): StartPose => robotStart(game, robot, alliance, { x, z, yaw });

  const moveTo = (clientX: number, clientY: number) => {
    const box = svg.current?.getBoundingClientRect();
    if (!box || box.width === 0) return;
    const x = length / 2 - ((clientX - box.left) / box.width) * length;
    const z = width / 2 - ((clientY - box.top) / box.height) * width;
    onChange(allowed(x, z, pose.yaw));
  };

  // Holding a turn key turns the robot smoothly. The latest pose is read from a ref so the loop is set up once.
  const latest = useRef({ pose, allowed, onChange, editable });
  latest.current = { pose, allowed, onChange, editable };
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
      if (!latest.current.editable) return;
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

  const { body, arrow } = outlinePoints(robot, pose, sx, sy);
  const turn = (by: number) => onChange(allowed(pose.x, pose.z, Math.round((pose.yaw + by) / TURN_STEP) * TURN_STEP));
  const zone = game.field.zoneDepth ?? 0;

  return (
    <div className="field-map">
      <svg
        ref={svg}
        viewBox={`0 0 ${length} ${width}`}
        role="img"
        aria-label="The field from above. Drag your robot to set where it starts."
        className={editable ? '' : 'locked'}
        onPointerDown={(event) => {
          if (!editable) return;
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
        {others.map((other) => {
          const shape = outlinePoints(other.robot, other.pose, sx, sy);
          return (
            <g key={other.key} className={`other-robot ${other.alliance}`}>
              <polygon className="robot" points={shape.body} />
              <polygon className="robot-front" points={shape.arrow} />
              <text x={sx(other.pose.x)} y={sy(other.pose.z) + 0.12} textAnchor="middle">
                {other.label}
              </text>
            </g>
          );
        })}
        <polygon className="robot" points={body} />
        <polygon className="robot-front" points={arrow} />
      </svg>
      <div className="field-map-foot">
        <span className="hint">
          {editable
            ? `Drag to place the robot. Hold ${keyLabel(keys.turnLeft)} or ${keyLabel(keys.turnRight)} to turn it, or use the buttons to turn it 45°.`
            : 'Only the host, or this player, can move this robot.'}
          {startZone
            ? underBars
              ? ' Its bumpers or frame must touch the starting line; it fits under the trench, so it may also start there on the line.'
              : ' Its bumpers or frame must touch the starting line.'
            : ''}
        </span>
        {editable && (
          <div className="button-row">
            <button className="small" aria-label="Turn 45 degrees left" onClick={() => turn(TURN_STEP)}>
              ⟲ 45°
            </button>
            <button className="small" aria-label="Turn 45 degrees right" onClick={() => turn(-TURN_STEP)}>
              ⟳ 45°
            </button>
            <button className="small" disabled={value === null} onClick={() => onChange(null)}>
              Reset
            </button>
          </div>
        )}
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
