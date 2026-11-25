import { useEffect, useMemo, useRef, useState } from 'react';
import { accountsAvailable, fetchRooms, signOut, type OpenRoom } from '../account/account';
import { configuredGame } from '../games';
import { robotStart } from '../games/start';
import type { Alliance } from '../games/types';
import { CODE_LENGTH, cleanCode } from '../net/peer';
import { CHAT_LENGTH, MAX_IN_ROOM, MAX_PER_ALLIANCE, mayChangeRobot, robotAllowed, type RobotRights, type Seat } from '../net/protocol';
import { asOfficialSkin } from '../robots/cosmetic';
import { multiplayer } from '../net/room';
import { OFFICIAL_ROBOTS } from '../robots';
import { epaOf } from '../robots/epa';
import type { RobotDefinition } from '../robots/types';
import { EpaTag } from './Epa';
import { FieldMap } from './FieldMap';
import { PlayerName } from './Record';
import { useGame, type RoomPlayerView, type RoomView } from './store';

const ALLIANCES: { id: Alliance; name: string }[] = [
  { id: 'blue', name: 'Blue alliance' },
  { id: 'red', name: 'Red alliance' },
];
const STATIONS = Array.from({ length: MAX_PER_ALLIANCE }, (_, i) => i + 1);
const RIGHTS: { id: RobotRights; label: string }[] = [
  { id: 'host', label: 'Host picks every robot' },
  { id: 'captain', label: 'Player 1 picks for their alliance' },
  { id: 'everyone', label: 'Everyone picks their own' },
];
/** How often the list of open matches is read again. */
const ROOMS_REFRESH_SECONDS = 10;

/** Hosting or joining a match with other players, and the room everyone waits in before it starts. */
export function Multiplayer() {
  const room = useGame((state) => state.room);
  const busy = useGame((state) => state.roomBusy);
  const error = useGame((state) => state.roomError);
  const setScreen = useGame((state) => state.setScreen);

  const back = () => {
    multiplayer.leave();
    useGame.getState().setRoomError(null);
    setScreen('home');
  };

  return (
    <div className="screen">
      <header className="screen-head">
        <button className="small" onClick={back}>
          {room ? 'Leave room' : 'Back'}
        </button>
        <h1>Multiplayer</h1>
        <span className="muted">{room ? `Room ${room.code}` : 'Up to three robots a side'}</span>
      </header>
      {room ? <Room room={room} /> : <Entrance busy={busy} error={error} />}
    </div>
  );
}

/** Before being in a room: the player's record and hosting on the left third, open matches on the rest. */
function Entrance({ busy, error }: { busy: boolean; error: string | null }) {
  const [code, setCode] = useState('');

  return (
    <div className="screen-body entrance">
      <div className="entrance-left">
        <section className="card">
          <h2>Host a match</h2>
          <p className="hint">You get a room code to share. If you leave, another player takes the room over and the match carries on.</p>
          <button className="primary" disabled={busy} onClick={() => void multiplayer.hostRoom()}>
            Host a match
          </button>
          <h2>Join with a code</h2>
          <label className="field">
            <span>Room code</span>
            <input
              className="code-input"
              type="text"
              value={code}
              placeholder={'A'.repeat(CODE_LENGTH)}
              onChange={(event) => setCode(cleanCode(event.target.value))}
            />
          </label>
          <button className="secondary" disabled={busy || code.length !== CODE_LENGTH} onClick={() => void multiplayer.join(code)}>
            Join
          </button>
          {busy && <p className="hint">Connecting…</p>}
          {error && <p className="hint lobby-error">{error}</p>}
        </section>
        <RecordCard />
      </div>
      <section className="card">
        {accountsAvailable ? (
          <OpenMatches busy={busy} />
        ) : (
          <>
            <h2>Open matches</h2>
            <p className="hint">The list of open matches is not set up for this copy of the game. Join with a room code instead.</p>
          </>
        )}
      </section>
    </div>
  );
}

/** Rooms other players have opened, to join with one click. */
function OpenMatches({ busy }: { busy: boolean }) {
  const [rooms, setRooms] = useState<OpenRoom[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let current = true;
    const read = () =>
      void fetchRooms().then((list) => {
        if (!current) return;
        setFailed(list === null);
        if (list) setRooms(list);
      });
    read();
    const timer = setInterval(read, ROOMS_REFRESH_SECONDS * 1000);
    return () => {
      current = false;
      clearInterval(timer);
    };
  }, []);

  return (
    <>
      <h2>Open matches</h2>
      {failed && <p className="hint">The list of open matches cannot be read right now.</p>}
      {!failed && rooms === null && <p className="hint">Looking for matches…</p>}
      {rooms?.length === 0 && <p className="hint">No open matches right now. Host one and it shows up here.</p>}
      <ul className="open-rooms">
        {rooms?.map((room) => (
          <li key={room.code}>
            <span>
              <strong>{room.host}</strong>
              <span className="muted">
                {' '}
                · {room.players} of 6 driving{room.spectators > 0 ? ` · ${room.spectators} watching` : ''} ·{' '}
                {room.playing ? 'match being played' : 'in the room'}
              </span>
            </span>
            <button className="small" disabled={busy} onClick={() => void multiplayer.join(room.code)}>
              {room.playing ? 'Watch' : 'Join'}
            </button>
          </li>
        ))}
      </ul>
      {rooms && rooms.some((room) => room.playing) && (
        <p className="hint">Joining a match being played puts you in to watch until it is over.</p>
      )}
    </>
  );
}

/** The player's record in brief, with the way to sign in or out. */
function RecordCard() {
  const account = useGame((state) => state.account);
  const stats = useGame((state) => state.record);
  const note = useGame((state) => state.accountNote);
  const showRecord = useGame((state) => state.showRecord);
  const showSignIn = useGame((state) => state.showSignIn);

  return (
    <section className="card">
      <h2>Your record</h2>
      <p className="hint">{account ? `Signed in as ${account.name}.` : 'Kept in this browser until you sign in.'}</p>
      <dl className="record-summary">
        <div>
          <dt className="muted">Matches</dt>
          <dd>
            <strong>{stats.matches}</strong>
          </dd>
        </div>
        <div>
          <dt className="muted">W-L-T</dt>
          <dd>
            <strong>
              {stats.wins}-{stats.losses}-{stats.ties}
            </strong>
          </dd>
        </div>
      </dl>
      {note && <p className="hint lobby-error">{note}</p>}
      <div className="button-row">
        <button className="secondary" onClick={() => showRecord(null)}>
          View your record
        </button>
        {account ? (
          <button className="secondary" onClick={() => void signOut()}>
            Sign out
          </button>
        ) : (
          accountsAvailable && (
            <button className="primary" onClick={showSignIn}>
              Sign in
            </button>
          )
        )}
      </div>
    </section>
  );
}

/** The id of the player being dragged between seats, shared by the drop targets. */
const DRAG_TYPE = 'application/x-room-player';

/** The room: the six driver stations, who is watching, the host's settings, and chat and starting spots on the side. */
function Room({ room }: { room: RoomView }) {
  const setScreen = useGame((state) => state.setScreen);
  const isHost = room.role === 'host';
  const [tab, setTab] = useState<'chat' | 'start'>('chat');
  const seated = room.players.filter((player) => player.seat).length;
  // Seated players whose custom robots this room does not allow: the match waits for them to pick another.
  const barred = room.players.filter((player) => player.seat && !robotAllowed(player.robot, room.settings));
  const spectators = room.players.filter((player) => !player.seat);

  return (
    <>
      <div className="screen-body room">
        <div className="room-main">
          <section className="card room-top">
            <div>
              <h2>Room code</h2>
              <p className="lobby-code">{room.code}</p>
            </div>
            <p className="hint">
              {room.notice ??
                (room.playing
                  ? 'A match is being played. Anyone who joins now watches until it is over.'
                  : isHost
                    ? 'Give this code to the players you want in the match. Drag players between stations, or to watching.'
                    : 'Drag yourself to an empty station, or to watching. The host starts the match.')}
            </p>
          </section>

          <div className="room-alliances">
            {ALLIANCES.map(({ id, name }) => {
              const players = room.players.filter((player) => player.seat?.alliance === id);
              const total = players.reduce((sum, player) => sum + (epaOf(player.robot) ?? 0), 0);
              return (
                <section className={`card lobby-side ${id}`} key={id}>
                  <h2>
                    {name}
                    {total > 0 && <span className="muted alliance-epa"> EPA {total.toFixed(1)}</span>}
                  </h2>
                  {STATIONS.map((station) => (
                    <SeatSlot key={station} room={room} seat={{ alliance: id, station }} />
                  ))}
                </section>
              );
            })}
          </div>

          <DropZone room={room} seat={null} className="card spectators">
            <h2>Watching ({spectators.length})</h2>
            {spectators.length === 0 && <p className="hint">Drag a player here to have them watch instead of drive.</p>}
            {spectators.map((player) => (
              <PlayerChip key={player.id} room={room} player={player} />
            ))}
          </DropZone>

          {isHost && <RoomSettingsCard room={room} />}
        </div>

        <aside className="card room-side">
          <div className="toggle-pair room-tabs" role="tablist">
            <button role="tab" aria-selected={tab === 'chat'} className={tab === 'chat' ? 'selected' : ''} onClick={() => setTab('chat')}>
              Chat
            </button>
            <button role="tab" aria-selected={tab === 'start'} className={tab === 'start' ? 'selected' : ''} onClick={() => setTab('start')}>
              Starting positions
            </button>
          </div>
          {tab === 'chat' ? <Chat room={room} /> : <StartPositions room={room} />}
        </aside>
      </div>
      <footer className="screen-foot">
        <span className="muted">
          {seated} of 6 driving{spectators.length > 0 ? `, ${spectators.length} watching` : ''} ({room.players.length} of {MAX_IN_ROOM} in the
          room). {room.settings.mode === 'match' ? 'Timed match, 2:40.' : 'Free practice, no clock.'}
        </span>
        {room.playing && room.hasMatch && (
          <button className="primary" onClick={() => setScreen('playing')}>
            Back to the match
          </button>
        )}
        {isHost && !room.playing && (
          <>
            <button className="secondary" onClick={() => setScreen('rules')}>
              Rules
            </button>
            {barred.length > 0 && (
              <span className="hint lobby-error">
                Custom robots are off: {barred.map((player) => player.name).join(', ')} must pick an official robot, or allow custom
                robots in the rules.
              </span>
            )}
            <button className="primary" disabled={seated === 0 || barred.length > 0} onClick={() => multiplayer.start()}>
              Start match
            </button>
          </>
        )}
        {!isHost && !room.playing && <span className="muted">Waiting for the host to start…</span>}
      </footer>
    </>
  );
}

/** Somewhere a player can be dropped: a driver station, or watching (seat null). */
function DropZone({
  room,
  seat,
  className,
  children,
}: {
  room: RoomView;
  seat: Seat | null;
  className: string;
  children: React.ReactNode;
}) {
  const [over, setOver] = useState(false);
  const isHost = room.role === 'host';
  return (
    <div
      className={`${className}${over ? ' drop-over' : ''}`}
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes(DRAG_TYPE)) return;
        event.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(event) => {
        setOver(false);
        const id = Number(event.dataTransfer.getData(DRAG_TYPE));
        if (!Number.isFinite(id)) return;
        // Only the host can move someone onto a taken station (they swap); anyone can take an empty one.
        const holder = seat && room.players.find((player) => player.seat?.alliance === seat.alliance && player.seat.station === seat.station);
        if (holder && holder.id !== id && !isHost) return;
        multiplayer.setSeat(id, seat);
      }}
    >
      {children}
    </div>
  );
}

function SeatSlot({ room, seat }: { room: RoomView; seat: Seat }) {
  const player = room.players.find((other) => other.seat?.alliance === seat.alliance && other.seat.station === seat.station);
  return (
    <DropZone room={room} seat={seat} className={`seat-slot${player ? '' : ' empty'}`}>
      <span className="seat-number">{seat.station}</span>
      {player ? (
        <PlayerChip room={room} player={player} />
      ) : (
        <button className="small seat-take" onClick={() => multiplayer.setSeat(room.myId, seat)}>
          Take this station
        </button>
      )}
    </DropZone>
  );
}

/** One player: their name, robot and EPA. The host also gets a menu to move, promote or remove them. */
function PlayerChip({ room, player }: { room: RoomView; player: RoomPlayerView }) {
  const customRobots = useGame((state) => state.customRobots);
  const setRobotId = useGame((state) => state.setRobotId);
  const isHost = room.role === 'host';
  const mine = player.id === room.myId;
  const canDrag = isHost || mine;
  const canPick = mayChangeRobot(room, room.myId, player.id);

  // Official robots strongest first, then this player's own robots when picking for themselves.
  const choices = useMemo(() => {
    const official = [...OFFICIAL_ROBOTS].sort((a, b) => (epaOf(b) ?? -1) - (epaOf(a) ?? -1) || a.name.localeCompare(b.name));
    const list: RobotDefinition[] = [...official, ...(mine ? customRobots : [])];
    if (!list.some((robot) => robot.id === player.robot.id)) list.push(player.robot);
    return list;
  }, [customRobots, mine, player.robot]);

  const pick = (id: string) => {
    const robot = choices.find((choice) => choice.id === id);
    if (!robot) return;
    // A player's own pick is also remembered as their robot for next time.
    if (mine) setRobotId(robot.id);
    else multiplayer.setRobot(player.id, robot);
  };

  return (
    <div
      className={`player-chip${mine ? ' mine' : ''}${canDrag ? ' draggable' : ''}`}
      draggable={canDrag}
      onDragStart={(event) => {
        event.dataTransfer.setData(DRAG_TYPE, String(player.id));
        event.dataTransfer.effectAllowed = 'move';
      }}
    >
      <div className="player-chip-name">
        <PlayerName player={player} />
        {mine && <span className="muted"> (you)</span>}
        {player.id === room.hostId && <span className="host-tag">Host</span>}
      </div>
      <div className="player-chip-robot">
        <EpaTag robot={player.robot} />
        {canPick ? (
          <select aria-label={`${player.name}'s robot`} value={player.robot.id} onChange={(event) => pick(event.target.value)}>
            {choices.map((robot) => (
              <option key={robot.id} value={robot.id}>
                {robot.name}
                {robot.official
                  ? ''
                  : asOfficialSkin(robot).official
                    ? ` (custom skin: ${asOfficialSkin(robot).name})`
                    : room.settings.customRobots
                      ? ' (custom)'
                      : ' (custom, not allowed here)'}
              </option>
            ))}
          </select>
        ) : (
          <span className="muted">{player.robot.name}</span>
        )}
        {player.robot.customSkin && <span className="custom-tag" title="An official robot in this player's own looks">Custom skin</span>}
        {!robotAllowed(player.robot, room.settings) && (
          <span className="custom-tag barred" title="This room only allows official robots">
            Not allowed
          </span>
        )}
      </div>
      {isHost && !mine && (
        <details className="player-actions">
          <summary aria-label={`Actions for ${player.name}`}>⋯</summary>
          <div className="player-actions-menu">
            {player.seat && <button onClick={() => multiplayer.setSeat(player.id, null)}>Move to watching</button>}
            <button onClick={() => multiplayer.makeHost(player.id)}>Make host</button>
            <button className="danger" onClick={() => multiplayer.kick(player.id)}>
              Remove from the room
            </button>
          </div>
        </details>
      )}
    </div>
  );
}

/** The host's choices for the room. */
function RoomSettingsCard({ room }: { room: RoomView }) {
  const index = RIGHTS.findIndex((rights) => rights.id === room.settings.robotRights);
  const step = (by: number) => multiplayer.setSettings({ robotRights: RIGHTS[(index + by + RIGHTS.length) % RIGHTS.length].id });
  return (
    <section className="card room-settings">
      <h2>Room settings</h2>
      <div className="stepper" role="group" aria-label="Who picks robots">
        <span className="stepper-label">Robots</span>
        <button aria-label="Previous choice" onClick={() => step(-1)}>
          ‹
        </button>
        <span className="stepper-value">{RIGHTS[index]?.label}</span>
        <button aria-label="Next choice" onClick={() => step(1)}>
          ›
        </button>
      </div>
      <div className="toggle-pair" role="group" aria-label="Match type">
        <button className={room.settings.mode === 'match' ? 'selected' : ''} onClick={() => multiplayer.setSettings({ mode: 'match' })}>
          Timed match
        </button>
        <button
          className={room.settings.mode === 'practice' ? 'selected' : ''}
          onClick={() => multiplayer.setSettings({ mode: 'practice' })}
        >
          Free practice
        </button>
      </div>
      {accountsAvailable && (
        <label className="check">
          <input type="checkbox" checked={room.settings.listed} onChange={(event) => multiplayer.setSettings({ listed: event.target.checked })} />
          Show this room in the list of open matches
        </label>
      )}
    </section>
  );
}

function Chat({ room }: { room: RoomView }) {
  const [text, setText] = useState('');
  const list = useRef<HTMLOListElement>(null);
  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight });
  }, [room.chat.length]);
  const send = () => {
    if (!text.trim()) return;
    multiplayer.say(text);
    setText('');
  };
  return (
    <div className="chat">
      <ol className="chat-lines" ref={list} aria-live="polite">
        {room.chat.length === 0 && <li className="muted">No messages yet.</li>}
        {room.chat.map((line, i) =>
          line.system ? (
            // A note from the room itself, in its own color and without a name.
            <li key={i} className="system">
              {line.text}
            </li>
          ) : (
            <li key={i} className={line.from === room.myId ? 'mine' : ''}>
              {/* The sender's name in their Drive Pass color, with their badge; plain if they have left. */}
              <strong>
                <PlayerName player={room.players.find((player) => player.id === line.from) ?? { name: line.name }} />
              </strong>{' '}
              {line.text}
            </li>
          ),
        )}
      </ol>
      <form
        className="chat-form"
        onSubmit={(event) => {
          event.preventDefault();
          send();
        }}
      >
        <input
          type="text"
          aria-label="Message"
          placeholder="Say something"
          maxLength={CHAT_LENGTH}
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
        <button className="small" type="submit" disabled={!text.trim()}>
          Send
        </button>
      </form>
    </div>
  );
}

/** Where each robot starts. Players place their own; the host can place anyone's. */
function StartPositions({ room }: { room: RoomView }) {
  const gameId = useGame((state) => state.gameId);
  const game = useMemo(() => configuredGame(gameId), [gameId]);
  const isHost = room.role === 'host';
  const seated = room.players.filter((player): player is RoomPlayerView & { seat: Seat } => player.seat !== null);
  const [chosen, setChosen] = useState<number | null>(null);
  const editing =
    seated.find((player) => player.id === (isHost ? chosen : room.myId)) ?? seated.find((player) => player.id === room.myId) ?? (isHost ? seated[0] : undefined);

  if (!editing) return <p className="hint">Take a driver station to place your robot.</p>;
  const others = seated
    .filter((player) => player.id !== editing.id)
    .map((player) => ({
      key: player.id,
      robot: player.robot,
      alliance: player.seat.alliance,
      pose: robotStart(game, player.robot, player.seat.alliance, player.pose, player.seat.station),
      label: `${player.seat.alliance === 'blue' ? 'B' : 'R'}${player.seat.station}`,
    }));

  return (
    <div className="start-positions">
      {isHost && (
        <label className="field">
          <span>Placing</span>
          <select value={editing.id} onChange={(event) => setChosen(Number(event.target.value))}>
            {seated.map((player) => (
              <option key={player.id} value={player.id}>
                {player.seat.alliance === 'blue' ? 'Blue' : 'Red'} {player.seat.station}: {player.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <FieldMap
        game={game}
        robot={editing.robot}
        alliance={editing.seat.alliance}
        station={editing.seat.station}
        value={editing.pose}
        onChange={(pose) => multiplayer.setPose(editing.id, pose)}
        others={others}
        editable={isHost || editing.id === room.myId}
      />
    </div>
  );
}
