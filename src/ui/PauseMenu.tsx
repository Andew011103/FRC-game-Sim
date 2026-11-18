import { multiplayer } from '../net/room';
import { PlayerList } from './PlayerList';
import { useGame } from './store';

export function PauseMenu({ onRestart }: { onRestart: () => void }) {
  const setScreen = useGame((state) => state.setScreen);
  const menu = useGame((state) => state.menu);
  const room = useGame((state) => state.room);

  return (
    <div className="screen centered">
      <div className="panel pause-panel">
        <h1>{room ? 'Menu' : 'Paused'}</h1>
        {room && <p className="hint">The match carries on while this is open.</p>}
        {room && <PlayerList />}
        <button className="primary" onClick={() => setScreen('playing')}>
          Resume
        </button>
        {room && (
          <button className="secondary" onClick={() => setScreen('multiplayer')}>
            Return to room
          </button>
        )}
        {(!room || room.role === 'host') && (
          <button className="secondary" onClick={room ? () => multiplayer.start() : onRestart}>
            {room ? 'Restart for everyone' : 'Restart'}
          </button>
        )}
        <button className="secondary" onClick={room ? () => multiplayer.leave() : () => setScreen(menu)}>
          {room ? 'Leave the room' : 'Leave match'}
        </button>
        {room?.role === 'host' && <p className="hint">If you leave, another player takes the room over and the match carries on.</p>}
      </div>
    </div>
  );
}
