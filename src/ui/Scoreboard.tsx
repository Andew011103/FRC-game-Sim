import type { Alliance } from '../games/types';
import { useGame, type AllianceView, type MatchView } from './store';

function clock(seconds: number): string {
  const whole = Math.ceil(seconds - 1e-6);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

/** Six dots in a pile: the game-piece count toward the next bonus. */
function PileIcon() {
  const dots: [number, number][] = [
    [12, 5],
    [8, 12],
    [16, 12],
    [4, 19],
    [12, 19],
    [20, 19],
  ];
  return (
    <svg className="scorebar-pile" viewBox="0 0 24 24" aria-hidden="true">
      {dots.map(([cx, cy], i) => (
        <circle key={i} cx={cx} cy={cy} r={3.2} />
      ))}
    </svg>
  );
}

/** The yellow square with a black arrow that marks the alliance whose goal is counting. */
function ActiveArrow({ alliance }: { alliance: Alliance }) {
  return (
    <svg className="scorebar-arrow" viewBox="0 0 24 24" role="img" aria-label="Goal active">
      <path
        d="M19 12H6M11 6l-6 6 6 6"
        transform={alliance === 'red' ? 'translate(24 0) scale(-1 1)' : undefined}
        fill="none"
        stroke="#111111"
        strokeWidth={2.6}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function Side({ alliance, view }: { alliance: Alliance; view: AllianceView }) {
  return (
    <div className={`scorebar-side ${alliance}`}>
      {view.progress && (
        <div className="scorebar-progress">
          <PileIcon />
          <span>
            {view.progress.value} / {view.progress.goal}
          </span>
        </div>
      )}
      <div className="scorebar-arrow-slot">{view.active && <ActiveArrow alliance={alliance} />}</div>
      <div className="scorebar-teams">
        {view.teams.map((team, i) => (
          <div className="scorebar-team" key={i}>
            {team.icon ? (
              <img src={team.icon} alt="" />
            ) : (
              <span className="scorebar-team-blank">{team.name.slice(0, 1).toUpperCase()}</span>
            )}
            <span>{team.number ?? team.name}</span>
          </div>
        ))}
      </div>
      <div className="scorebar-score">{view.score}</div>
    </div>
  );
}

/** What goes under the clock: which part of teleop this is and how long it has left. */
function stageText(match: MatchView): string {
  if (match.mode !== 'match') return 'PRACTICE';
  if (match.stage) {
    return `${match.stage.index} / ${match.stage.total}   :${String(Math.ceil(match.phaseRemaining - 1e-6)).padStart(2, '0')}`;
  }
  return match.phaseId === 'auto' ? 'AUTO' : 'FINAL';
}

/** The bar across the top of the screen during a match, laid out like the official audience display. */
export function Scoreboard() {
  const match = useGame((state) => state.match);
  if (!match) return null;

  // Like the real display, the clock counts down each period: auto, then the whole of teleop.
  const time = match.phaseId === 'auto' ? match.phaseRemaining : match.remaining;

  return (
    <div className="scorebar">
      <Side alliance="blue" view={match.blue} />
      <div className="scorebar-clock">
        <span className="scorebar-time">{match.mode === 'match' ? clock(time) : '∞'}</span>
        <span className="scorebar-stage">{stageText(match)}</span>
      </div>
      <Side alliance="red" view={match.red} />
    </div>
  );
}
