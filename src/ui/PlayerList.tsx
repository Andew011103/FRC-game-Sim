import { PlayerName } from './Record';
import { useGame } from './store';

/** Everyone in the multiplayer match, by alliance. A signed-in player's name opens their record. */
export function PlayerList() {
  const room = useGame((state) => state.room);
  if (!room) return null;
  return (
    <div className="player-list">
      {(['blue', 'red'] as const).map((alliance) => (
        <ul key={alliance} className={alliance}>
          {room.players
            .filter((player) => player.alliance === alliance)
            .map((player) => (
              <li key={player.id}>
                <PlayerName player={player} />
                <span className="muted">{player.robot}</span>
              </li>
            ))}
        </ul>
      ))}
    </div>
  );
}
