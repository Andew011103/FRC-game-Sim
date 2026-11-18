import { PlayerName } from './Record';
import { useGame } from './store';

/** Everyone in the multiplayer room, by alliance and station, then who is watching. A signed-in player's name opens their record. */
export function PlayerList() {
  const room = useGame((state) => state.room);
  if (!room) return null;
  const watching = room.players.filter((player) => !player.seat);
  return (
    <div className="player-list">
      {(['blue', 'red'] as const).map((alliance) => (
        <ul key={alliance} className={alliance}>
          {room.players
            .filter((player) => player.seat?.alliance === alliance)
            .sort((a, b) => a.seat!.station - b.seat!.station)
            .map((player) => (
              <li key={player.id}>
                <span className="muted">{player.seat!.station}</span> <PlayerName player={player} />
                <span className="muted">{player.robot.name}</span>
              </li>
            ))}
        </ul>
      ))}
      {watching.length > 0 && (
        <p className="hint player-list-watching">
          Watching:{' '}
          {watching.map((player, i) => (
            <span key={player.id}>
              {i > 0 && ', '}
              <PlayerName player={player} />
            </span>
          ))}
        </p>
      )}
    </div>
  );
}
