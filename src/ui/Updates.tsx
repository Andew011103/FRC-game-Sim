import { useGame } from './store';

/** What changed in each update, newest first. Add a new entry at the top. */
const UPDATES: { title: string; changes: string[] }[] = [
  {
    title: 'Multiplayer rooms, and match day details',
    changes: [
      'Rooms have six driver stations: drag players between them, or to watching. Each station is its own driver camera spot.',
      'Pick robots and starting spots in the room. The host chooses who may change robots: the host, each alliance’s player 1, or everyone.',
      'Chat in the room, and the host can remove players or make someone else host.',
      'If the host leaves or loses connection, another player takes the room over and the match carries on. It also keeps running in a tab out of sight.',
      'Players who leave free their place. Anyone joining mid-match watches until it is over, and up to 16 can be in a room.',
      'After a match, everyone returns to the same room. Open matches are listed on the Multiplayer screen.',
      'Matches start with a 3, 2, 1 countdown and stop for 3 seconds after auto. Timed matches are the default.',
      'Robots start touching the starting line, and can be turned 45° at a time.',
      'Official robots show an EPA rating, coloured by rank, and the robot selector sorts by it.',
      'Shot blockers can slide and travel in any direction as they come out, and stop shots right at the shooter.',
      'Builder: fire rate up to 32 a second, hoppers up to 200 pieces, and a climb time of up to 10 seconds.',
      'Each outpost starts the match with its 24 fuel inside, and takes fuel in five a second.',
      'Fuel grips the carpet more and stops rolling much sooner.',
    ],
  },
  {
    title: 'Truer shooting, and settings in your account',
    changes: [
      'Shooters that adjust for distance now drop fuel into the middle of the hub instead of slightly long.',
      'The launch angle is the steepest a shooter can use; for long shots it flattens as far as it needs to.',
      'Signed in, your chosen robot and all your settings, controls included, follow you to any device.',
    ],
  },
  {
    title: 'Player records',
    changes: [
      'A record screen for every player: matches, wins and losses, favourite robots and scores.',
      'Each robot now has its own score in multiplayer, and timed singleplayer matches are recorded.',
      'In a multiplayer room, a signed-in player’s name opens their record.',
    ],
  },
  {
    title: 'Multiplayer, first version',
    changes: [
      'Host a match and share its room code, or join one with a code. Up to three robots a side.',
      'Players connect straight to the host, whose computer runs the match.',
      'Your record of multiplayer matches: win rate, most played robot and scores.',
      'Sign in to keep that record in an account that follows you to any device.',
    ],
  },
  {
    title: 'Shooter options',
    changes: [
      'A shooter can be given its own fire rate for auto.',
      'A shooter can correct for the robot leaning, so it still scores from the bump or on top of fuel.',
      'Tower frames are in the alliance colour, with bare metal rungs.',
    ],
  },
  {
    title: 'Tidier display and controls',
    changes: [
      'A slimmer score bar with room for three teams a side, and a smaller fuel counter.',
      'Settings can show or hide the info panel, the list of controls and the speed readout.',
      'Fuel counts as it leaves the hub, about half a second after it goes in.',
      'New colour palettes: SRPP, Paly Robotics, Peninsula Robotics, MVRT and HighTide.',
      'New default keys: Q outtakes, E expands the hopper, K works the blocker and the climber. One key climbs both ways.',
      'Shoot and intake can be set to switch on and off with a press.',
      'The driver station camera turns to follow the robot, and can stand at station 1, 2 or 3.',
      'The robot selector sorts by name or number and lists only what sets a robot apart.',
      'Team numbers fill the height of the bumper.',
      'The builder starts empty, with a Create robot button.',
    ],
  },
  {
    title: 'Official score display',
    changes: [
      'The score bar copies the official display: team icons and numbers, fuel toward the next ranking point, the active-hub arrow and the shift clock.',
      'Team numbers and icons can be set in the builder; the number is painted on the bumpers.',
      'Robots must start touching their alliance zone, and shoot at the hub whenever a bumper is over its line.',
      'Flip-out blockers hang down when stowed and swing up into a flat roof.',
      'Outtaking sprays fuel across the whole width of the intake.',
      'Closing a hopper extension spills the fuel that was in it; fill levels show the hopper filling before its extension.',
      'Fuel that leaves the field is thrown back in.',
      'Reset now resets the whole field.',
    ],
  },
  {
    title: 'Separate screens',
    changes: [
      'The game is now a set of separate screens: home, singleplayer, robot selector, rules, settings and these update logs.',
      'Choose your alliance, and place your robot on a map of the whole field before a match.',
      'Robot selector with a picture and stat bars for every robot.',
      'Colour palettes, your own key and gamepad bindings, constant intake and an automatic aiming switch.',
      'Fouls: touching fuel leaving the hub, contact across the centre line in auto, pinning, and contact at the tower in the end game.',
      'Robots can be labelled as trench or bump robots in the builder.',
    ],
  },
  {
    title: 'Match rules',
    changes: [
      'Human player skill, the amount of fuel, and switches for the depot, outpost and tower.',
      'Round hoppers, intake reach, and fill levels that also show on hopper extensions.',
      'Flip-up blockers hinge on an edge.',
    ],
  },
  {
    title: 'A more real field',
    changes: [
      'The hub has sloped light faces and a six-sided funnel that fuel can bounce out of.',
      'The trench is a bar to drive under; tall robots do not fit.',
      'Fuel that scores within 3 seconds of a period ending still counts.',
      'The outpost takes fuel pushed into it, and the human player throws it at the hub.',
      'Outtake for intakes, and blockers that rise or flip up.',
    ],
  },
  {
    title: 'Passing and hub lights',
    changes: [
      'Outside your alliance zone, shooters pass fuel back to your side.',
      'Hub lights show the stage of the match.',
      'Hoppers show how full they are.',
      'Robots no longer ride up onto piles of fuel.',
    ],
  },
  {
    title: 'Shooting',
    changes: [
      'Fixed shooters turn the robot to face the hub; turrets turn themselves.',
      'Shoot on the Move, multi-lane shooters and staggered shot timing.',
      'Expanding hoppers slide out.',
    ],
  },
  {
    title: 'Robot builder',
    changes: [
      'Every mechanism is a box you size and place freely.',
      'The frame and each side of the bumpers can be reshaped.',
    ],
  },
  {
    title: 'REBUILT',
    changes: ['The 2026 field, fuel, hubs, towers and match timeline.', 'Driving sandbox with swerve and tank drives.'],
  },
];

/** A list of what each update changed. */
export function Updates() {
  const setScreen = useGame((state) => state.setScreen);
  return (
    <div className="screen">
      <header className="screen-head">
        <button className="small" onClick={() => setScreen('home')}>
          Back
        </button>
        <h1>Update logs</h1>
      </header>
      <div className="screen-body narrow">
        {UPDATES.map((update) => (
          <section className="card" key={update.title}>
            <h2>{update.title}</h2>
            <ul className="plain-list">
              {update.changes.map((change) => (
                <li key={change}>{change}</li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
