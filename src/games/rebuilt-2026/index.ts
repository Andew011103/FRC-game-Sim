import { resolveFields, type FieldSpec } from '../../sim/subsystems/types';
import type { GameDefinition } from '../types';
import { FIELD, buildField, goals, passTarget, spawns, startAreas, startZone, targets, type FieldSetup } from './field';
import { createRebuiltRules, type HumanPlayer } from './rules';

/** How good the human player at the outpost is: throws per second and the share that go in. */
const HUMAN_PLAYERS: Record<string, HumanPlayer & { name: string }> = {
  brick: { name: 'Brick', perSecond: 1, accuracy: 0.1 },
  average: { name: 'Average', perSecond: 2, accuracy: 0.3 },
  default: { name: 'Default', perSecond: 2.5, accuracy: 0.5 },
  skilled: { name: 'Skilled', perSecond: 3, accuracy: 0.65 },
  lebron: { name: 'Lebron', perSecond: 3, accuracy: 0.737 },
  fourth: { name: 'Fourth Robot', perSecond: 8, accuracy: 0.9 },
};

const FUEL_AMOUNTS: Record<string, { label: string; fuel: FieldSetup['fuel'] }> = {
  one: { label: '1 fuel', fuel: { one: true } },
  quarter: { label: '×0.25', fuel: { scale: 0.25 } },
  half: { label: '×0.5', fuel: { scale: 0.5 } },
  default: { label: 'Default (504)', fuel: { scale: 1 } },
  more: { label: '×1.5', fuel: { scale: 1.5 } },
  double: { label: '×2', fuel: { scale: 2 } },
  thousand: { label: '1,000 fuel', fuel: { total: 1000 } },
};

interface RebuiltOptions {
  humanPlayer: string;
  fuel: string;
  depot: boolean;
  outpost: boolean;
  tower: boolean;
  fouls: boolean;
}

/** The choices offered on the menu before a match. */
const OPTIONS: FieldSpec[] = [
  {
    key: 'humanPlayer',
    label: 'Human player',
    kind: 'choice',
    default: 'default',
    options: Object.entries(HUMAN_PLAYERS).map(([value, player]) => ({
      value,
      label: `${player.name} · ${player.perSecond}/s · ${+(player.accuracy * 100).toFixed(1)}% in`,
    })),
  },
  {
    key: 'fuel',
    label: 'Fuel on the field',
    kind: 'choice',
    default: 'default',
    options: Object.entries(FUEL_AMOUNTS).map(([value, amount]) => ({ value, label: amount.label })),
  },
  { key: 'depot', label: 'Depot', kind: 'boolean', default: true },
  { key: 'outpost', label: 'Outpost and human player', kind: 'boolean', default: true },
  { key: 'tower', label: 'Tower', kind: 'boolean', default: true },
  { key: 'fouls', label: 'Fouls (5 points minor, 15 major, to the other alliance)', kind: 'boolean', default: true },
];

/** The 2026 game, set up with the given menu choices. Anything missing or invalid falls back to standard. */
function build(values: Record<string, unknown>): GameDefinition {
  const options = resolveFields<RebuiltOptions>(OPTIONS, values);
  const fuel = FUEL_AMOUNTS[options.fuel].fuel;
  const { statics, pieces, towers } = buildField({
    fuel,
    depot: options.depot,
    outpost: options.outpost,
    tower: options.tower,
  });
  return {
    id: 'rebuilt-2026',
    name: 'REBUILT (2026)',
    description: 'Shoot fuel into your hub while it is active, then climb the tower.',
    field: FIELD,
    statics,
    props: [],
    spawns,
    pieces,
    targets,
    goals,
    towers,
    passTarget,
    startAreas,
    startZone,
    // With a single piece on the field, robots do not start with any of their own.
    preload: 'one' in fuel ? 0 : 8,
    createRules: () => createRebuiltRules({
        humanPlayer: options.outpost ? HUMAN_PLAYERS[options.humanPlayer] : null,
        fouls: options.fouls,
      }),
    options: OPTIONS,
    configure: build,
  };
}

export const rebuilt2026: GameDefinition = build({});
