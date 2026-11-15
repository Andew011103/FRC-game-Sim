import { rebuilt2026 } from './rebuilt-2026';
import { sandbox } from './sandbox';
import type { GameDefinition } from './types';

/** Every field the player can choose. Add new seasons here. */
export const GAMES: GameDefinition[] = [rebuilt2026, sandbox];

export function findGame(id: string): GameDefinition {
  return GAMES.find((game) => game.id === id) ?? GAMES[0];
}

/** A game set up with the player's menu choices, for games that have any. */
export function configuredGame(id: string, options: Record<string, unknown> = {}): GameDefinition {
  const game = findGame(id);
  return game.configure?.(options) ?? game;
}
