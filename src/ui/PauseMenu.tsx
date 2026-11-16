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
        {(!room || room.role === 'host') && (
          <button className="secondary" onClick={room ? () => multiplayer.start() : onRestart}>
            {room ? 'Restart for everyone' : 'Restart'}
          </button>
        )}
        <button className="secondary" onClick={room ? () => multiplayer.leave() : () => setScreen(menu)}>
          {room?.role === 'host' ? 'End match for everyone' : 'Leave match'}
        </button>
      </div>
    </div>
  );
}
