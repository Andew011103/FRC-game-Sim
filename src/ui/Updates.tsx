import { useGame } from './store';

/** What changed in each update, newest first. Add a new entry at the top. */
const UPDATES: { title: string; changes: string[] }[] = [
  {
    title: 'Leaderboards',
    changes: [
      'Leaderboards for every official robot and a Season Overall board, ranking each signed-in player by their best timed singleplayer score this season.',
      'A first top-3 place on the Season Overall board earns 15, 12 or 10 Ranking Points, once a season.',
      'First place on some robots’ boards wears an exclusive champion skin, for as long as they stay first.',
      'A countdown to the end of the season on the Drive Pass and the Season Overall board.',
      'Your five best leaderboard places show on your player record.',
      'Names in room chat show their Drive Pass colour and badge.',
      'Fuel scores by the hub’s state as it comes out, so a shot just before a hub turns on counts. Hubs take about half a second to process fuel.',
      'Fuel comes out of the back of the hub about 3 feet up, spread out a little.',
      'Hoppers can be open on top: fuel falling onto them drops straight in. Only robots with one are fouled for taking fuel from the hub before it lands.',
      'Speed presets: keys 1, 2 and 3 hold driving to 25%, 50% and 75% of top speed; press again for full speed. Change the percentages in Settings.',
      'LED strips and structures can be turned any way: about the up axis, tilted and rolled.',
      'See-through structures, only for looks, can be added to any robot. They and LED strips count as decorations (up to 12), not toward the 8 subsystems.',
      'Game piece effects: fuel you shoot can glow, pulse, blink, run through the rainbow, trail flames, a comet streak or sparkles, crackle with electricity, or have two lights orbit it. Unlock them in the Drive Pass, or get one with a skin.',
      'Pick your game piece effect in the robot selector. A skin that comes with its own effect shows it on a flying fuel ball above the robot instead. Turn every fuel effect off, yours and everyone else’s, in Settings.',
      'Your own player page, from the button with your name at the top right of the main menu, now also lists the skins, game piece effects, name colours and badges you own, to equip or take off.',
      'The Drive Pass has its own button at the top right of the main menu.',
      'Each game piece effect has three separate strengths: how much of its colour the fuel takes on, how bright its glow is, and how strong its trail or sparks are.',
    ],
  },
  {
    title: 'Drive Pass and LED strips',
    changes: [
      'The Drive Pass: earn Ranking Points by playing, and unlock robot skins, name colours, name badges, LED effects and colour themes.',
      'Equip rewards on the Drive Pass screen. Skins can also be picked in the robot selector. Other players see your skin, name colour and badge.',
      'A new LED strip mechanism lights up in its own colour and pattern for idling, shooting, shooting on the move, passing, climbing and blocking.',
      'LED effects: chase (a light with a fading tail running along), bounce (a blip bouncing end to end) and blink (two quick flashes). The steady on and off pattern is now called flash.',
      'Skins can now add see-through structures and lights, not just recolour, and every player sees them.',
      'Ranking Points: 3 for a multiplayer win, 1 for a tie, 1 for each bonus your alliance earns, and 1 for a timed singleplayer match. The results show what a match earned.',
      'Energized now needs 630 fuel and Supercharged 1000; Traversal stays at 50 tower points.',
      'Fouls are added to the score only when the match ends. A brief note shows when one is called.',
      'The Drive Pass runs in seasons: each starts everyone from zero Ranking Points, and rewards unlocked earlier stay yours (except name badges).',
      'Name badges can be pictures as well as letters or emoji.',
      'Builder: a Duplicate button makes an identical copy of any part.',
      'Hoppers can have chamfered or rounded corners, like the frame.',
    ],
  },
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
      'Builder: a round frame option, with one ring of bumper, to go with drum hoppers.',
      'Builder: any corner of the frame can be chamfered or rounded, each by its own amount. The bumpers, wheels and collisions follow the shape.',
      'Shooters can have an aim delay: a wait once lined up before the first shot.',
      'In a match, the host can end it for everyone from the menu; nobody else can go back to the room until it ends.',
      'Joining a match in progress clearly shows you are watching, and the camera key steps through views of every robot.',
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
