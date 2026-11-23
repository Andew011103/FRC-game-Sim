import { beforeAll, describe, expect, it } from 'vitest';
import { NEUTRAL_INPUT } from '../src/input/types';
import { PROTOCOL, buildNetWorld, decodeInput, encodeInput, loopback, type MatchSetup } from '../src/net/protocol';
import { ClientSession, HostSession } from '../src/net/session';
import { SnapshotReader, SnapshotWriter } from '../src/net/snapshot';
import { findRobot } from '../src/robots';
import { initPhysics } from '../src/sim/world';
import { input } from './helpers';

const poofs = () => findRobot('cheesy-poofs');
const simbotics = () => findRobot('simbotics');

function setup(players = 2): MatchSetup {
  return {
    gameId: 'rebuilt-2026',
    options: {},
    mode: 'match',
    seed: 7,
    players: Array.from({ length: players }, (_, id) => ({
      id,
      name: `Player ${id}`,
      robot: id % 2 ? simbotics() : poofs(),
      seat: { alliance: id % 2 ? ('red' as const) : ('blue' as const), station: Math.floor(id / 2) + 1 },
      pose: null,
    })),
  };
}

describe('multiplayer', () => {
  beforeAll(() => initPhysics());

  it("a driver's input survives being sent", () => {
    const sent = input({ driveX: -1, driveY: 0.5, turn: 1, shoot: true, climbUp: true });
    const { input: got, prefs } = decodeInput(encodeInput(sent, { fieldCentric: false, autoAim: true }));
    expect(prefs).toEqual({ fieldCentric: false, autoAim: true });
    expect(got.driveX).toBe(-1);
    expect(got.driveY).toBeCloseTo(0.5, 2);
    expect(got).toMatchObject({ turn: 1, shoot: true, climbUp: true, intake: false, block: false });
    expect(decodeInput(new ArrayBuffer(9)).input).toEqual(NEUTRAL_INPUT);
  });

  it('six robots start apart from each other on the starting line, each with its preload', () => {
    const sim = buildNetWorld(setup(6));
    const start = sim.robots.map((robot) => robot.position());
    for (let i = 0; i < 60; i++) sim.step([]);
    sim.robots.forEach((robot, i) => {
      expect(robot.held.length).toBe(8);
      // A robot whose mechanisms reach past its bumpers may settle back a little from the hub in front of it.
      expect(Math.hypot(robot.position().x - start[i].x, robot.position().z - start[i].z)).toBeLessThan(0.12);
    });
    expect(sim.robots.filter((robot) => robot.alliance === 'blue').length).toBe(3);
    sim.dispose();
  });

  it("a copy of the field follows the host's through snapshots", () => {
    const host = buildNetWorld(setup());
    const copy = buildNetWorld(setup());
    const writer = new SnapshotWriter();
    const reader = new SnapshotReader();
    const drive = [input({ driveY: 1, intake: true }), input({ driveY: 1, shoot: true })];
    let quiet = 0;
    for (let tick = 1; tick <= 420; tick++) {
      host.step(tick < 360 ? drive : []);
      if (tick % 2) continue;
      const snapshot = writer.write(host, tick);
      if (tick === 2) expect(snapshot.byteLength).toBeGreaterThan(4000);
      if (tick === 4) quiet = snapshot.byteLength;
      reader.apply(copy, snapshot);
    }

    expect(reader.tick).toBe(420);
    host.robots.forEach((robot, i) => {
      const there = robot.position();
      const here = copy.robots[i].position();
      expect(Math.hypot(there.x - here.x, there.y - here.y, there.z - here.z)).toBeLessThan(0.001);
      expect(copy.robots[i].heading()).toBeCloseTo(robot.heading(), 3);
      expect([...copy.robots[i].held].sort()).toEqual([...robot.held].sort());
      expect(reader.extras[i].capacity).toBe(robot.capacity());
      const parts = robot.subsystems.flatMap((subsystem) => subsystem.parts);
      const copied = copy.robots[i].subsystems.flatMap((subsystem) => subsystem.parts);
      parts.forEach((part, p) => {
        expect(copied[p].visible).toBe(part.visible);
        expect(copied[p].size[1]).toBeCloseTo(part.size[1], 4);
      });
    });
    // The red robot shot its fuel, so the two fields have the same fuel loose in the same places.
    expect(host.robots[1].held.length).toBeLessThan(8);
    for (let i = 0; i < host.pieces.count; i++) {
      expect(copy.pieces.heldBy[i]).toBe(host.pieces.heldBy[i]);
      if (host.pieces.heldBy[i] !== -1) continue;
      for (let k = 0; k < 3; k++) expect(copy.pieces.cur[i * 3 + k]).toBeCloseTo(host.pieces.cur[i * 3 + k], 2);
    }
    // Before anything has moved, a snapshot is a tiny fraction of the whole field.
    expect(quiet).toBeLessThan(200);
    host.dispose();
    copy.dispose();
  });

  it('a second player joins, drives their own robot and sees the score', () => {
    const [hostEnd, clientEnd] = loopback();
    const host = new HostSession('Host', poofs());
    host.accept(hostEnd);
    let time = 0;
    const client = new ClientSession(clientEnd, '  Guest with a very long name indeed  ', simbotics(), () => time);

    expect(client.id).toBe(1);
    expect(client.room!.players.map((player) => player.seat)).toEqual([
      { alliance: 'blue', station: 1 },
      { alliance: 'red', station: 1 },
    ]);
    expect(client.room!.players[1].name).toBe('Guest with a very lo');
    // An official robot arrives as itself.
    expect(host.players[1].robot.official).toBe(true);

    // The guest moves to another station and back; the host could move anyone.
    client.request({ type: 'seat', id: 1, seat: { alliance: 'red', station: 3 } });
    expect(host.players[1].seat).toEqual({ alliance: 'red', station: 3 });
    host.request(0, { type: 'seat', id: 1, seat: { alliance: 'red', station: 1 } });
    expect(client.room!.players[1].seat).toEqual({ alliance: 'red', station: 1 });

    const sim = host.start('rebuilt-2026', {}, 'match', 3);
    expect(client.robotIndex).toBe(1);
    const copy = client.sim!;
    const start = copy.robots[1].position();
    // The countdown first, then two seconds of driving.
    for (let tick = 0; tick < 300; tick++) {
      client.sendInput(input({ driveY: 1 }), { fieldCentric: true, autoAim: false });
      host.step(NEUTRAL_INPUT);
      time += 1 / 60;
    }
    // Only the guest's robot moved, on both fields.
    expect(Math.abs(sim.robots[1].position().x - start.x)).toBeGreaterThan(1);
    expect(copy.robots[1].position().x).toBeCloseTo(sim.robots[1].position().x, 2);
    expect(sim.robots[0].speed()).toBeLessThan(0.05);
    expect(copy.match!.elapsed).toBeCloseTo(2, 1);
    expect(client.status!.blue.label).toBe(sim.rules!.status(sim, 'blue').label);
    expect(client.extras()!.capacity).toBe(sim.robots[1].capacity());
    expect(client.blend()).toBeGreaterThanOrEqual(0);
    expect(sim.robots[1].autoAim).toBe(false);
    expect(client.bonuses!.red.length).toBe(sim.rules!.bonuses(sim, 'red').length);

    // A player who drops out mid-match gives up their place; their robot stays on the field, undriven.
    client.close();
    host.step(NEUTRAL_INPUT);
    expect(host.players.length).toBe(1);
    expect(sim.robots.length).toBe(2);
    host.close();
    sim.dispose();
  });

  it('turns away players it cannot take, and puts late arrivals in to watch', () => {
    const host = new HostSession('Host', poofs());
    const join = (robot: unknown, protocol = PROTOCOL) => {
      const [hostEnd, clientEnd] = loopback();
      host.accept(hostEnd);
      let refused = '';
      clientEnd.onMessage = (data) => {
        const message = JSON.parse(data as string);
        if (message.type === 'refused') refused = message.reason;
      };
      clientEnd.send(JSON.stringify({ type: 'join', protocol, name: 'x', robot }));
      return refused;
    };
    expect(join('cheesy-poofs', PROTOCOL + 1)).toMatch(/version/);
    expect(join(42)).toMatch(/robot/);
    for (let i = 0; i < 5; i++) expect(join('cheesy-poofs')).toBe('');
    expect(host.players.filter((player) => player.seat?.alliance === 'red').length).toBe(3);
    // The seventh player has no station left and watches.
    expect(join('cheesy-poofs')).toBe('');
    expect(host.players[6].seat).toBeNull();
    host.start('rebuilt-2026', {}, 'practice');
    expect(host.sim!.robots.length).toBe(6);
    // Someone arriving mid-match watches too.
    expect(join('cheesy-poofs')).toBe('');
    expect(host.players[7].seat).toBeNull();
    for (let i = 0; i < 8; i++) join('cheesy-poofs');
    expect(join('cheesy-poofs')).toMatch(/full/);
    host.close();
    host.sim!.dispose();
  });

  it('lets each player pick only the robots the room allows, and passes chat around', () => {
    const host = new HostSession('Host', poofs());
    const clients = [0, 1, 2].map(() => {
      const [hostEnd, clientEnd] = loopback();
      host.accept(hostEnd);
      return new ClientSession(clientEnd, 'Guest', simbotics());
    });
    // Blue 1 is the host, red 1 the first guest, blue 2 the second, red 2 the third.
    const [red1, blue2, red2] = clients;
    expect(blue2.room!.players.find((player) => player.id === blue2.id)!.seat).toEqual({ alliance: 'blue', station: 2 });
    const robotOf = (client: ClientSession) => host.players.find((player) => player.id === client.id)!.robot.id;

    // By default everyone picks their own.
    red2.request({ type: 'robot', id: red2.id!, robot: 'cheesy-poofs' });
    red2.request({ type: 'robot', id: red1.id!, robot: 'cheesy-poofs' });
    expect(robotOf(red2)).toBe('cheesy-poofs');
    expect(robotOf(red1)).toBe('simbotics');

    // Player 1 of each alliance picks for their alliance.
    host.setSettings({ robotRights: 'captain' });
    red1.request({ type: 'robot', id: red2.id!, robot: 'simbotics' });
    red1.request({ type: 'robot', id: blue2.id!, robot: 'cheesy-poofs' });
    red2.request({ type: 'robot', id: red2.id!, robot: 'cheesy-poofs' });
    expect(robotOf(red2)).toBe('simbotics');
    expect(robotOf(blue2)).toBe('simbotics');

    // Only the host.
    host.setSettings({ robotRights: 'host' });
    red1.request({ type: 'robot', id: red1.id!, robot: 'cheesy-poofs' });
    expect(robotOf(red1)).toBe('simbotics');
    host.request(0, { type: 'robot', id: red1.id!, robot: 'cheesy-poofs' });
    expect(robotOf(red1)).toBe('cheesy-poofs');

    // A guest cannot take a station someone holds; the host can, and the two swap.
    blue2.request({ type: 'seat', id: blue2.id!, seat: { alliance: 'red', station: 1 } });
    expect(host.players.find((player) => player.id === blue2.id)!.seat).toEqual({ alliance: 'blue', station: 2 });
    host.request(0, { type: 'seat', id: blue2.id!, seat: { alliance: 'red', station: 1 } });
    expect(host.players.find((player) => player.id === red1.id)!.seat).toEqual({ alliance: 'blue', station: 2 });

    // Chat reaches everyone, trimmed, and nobody can flood it.
    red2.request({ type: 'chat', text: '  good luck  ' });
    expect(red1.chat.at(-1)).toEqual({ from: red2.id, name: 'Guest', text: 'good luck' });
    for (let i = 0; i < 10; i++) red2.request({ type: 'chat', text: `spam ${i}` });
    expect(host.chat.filter((line) => !line.system).length).toBeLessThanOrEqual(5);

    // The host can send a player out.
    host.kick(red2.id!);
    expect(red2.closedBecause).toBe('kicked');
    expect(host.players.length).toBe(3);
    host.close();
  });

  it('another player takes the room over when the host leaves, and the match carries on', () => {
    const host = new HostSession('Host', poofs());
    const links = [0, 1].map(() => loopback());
    for (const [hostEnd] of links) host.accept(hostEnd);
    const [first, second] = links.map(([, clientEnd]) => new ClientSession(clientEnd, 'Guest', simbotics()));
    const sim = host.start('rebuilt-2026', {}, 'match', 5);
    for (let tick = 0; tick < 240; tick++) host.step(input({ driveY: 1 }));
    expect(host.successor()).toBe(first.id);

    // The host leaves: everyone is told who takes over.
    host.handOver(first.id!, false);
    host.close();
    sim.dispose();
    expect(first.closedBecause).toBe('handover');
    expect(second.handoverTo).toBe(first.id);

    // The first guest opens the room again from its copy of the field; the second reconnects to it.
    const room = { ...first.room!, players: first.room!.players.filter((player) => player.id !== first.room!.hostId) };
    const next = new HostSession('Guest', simbotics(), undefined, {
      myId: first.id!,
      room: { ...room, hostId: -1 },
      chat: first.chat,
      sim: first.sim,
      setup: first.setup,
    });
    const [hostEnd, clientEnd] = loopback();
    next.accept(hostEnd);
    const back = new ClientSession(clientEnd, 'Guest', simbotics(), undefined, undefined, {
      id: second.id!,
      sim: second.sim,
      setup: second.setup,
      chat: second.chat,
    });
    expect(back.id).toBe(second.id);
    expect(next.players.map((player) => player.id)).toEqual([first.id, second.id]);
    // Nobody started a new match: the second guest keeps the field it had, and it follows the new host's.
    expect(back.sim).toBe(second.sim);
    const clock = next.sim!.match!.elapsed;
    const robot = next.robotOf(second.id!);
    const from = next.sim!.robots[robot].position();
    for (let tick = 0; tick < 120; tick++) {
      // Backwards, away from the hub its station faces.
      back.sendInput(input({ driveY: -1 }));
      next.step(NEUTRAL_INPUT);
    }
    expect(next.sim!.match!.elapsed).toBeGreaterThan(clock + 1.9);
    // The second guest drives its own robot on the new host's field, and sees it move on its own.
    expect(Math.abs(next.sim!.robots[robot].position().x - from.x)).toBeGreaterThan(1);
    expect(back.sim!.robots[robot].position().x).toBeCloseTo(next.sim!.robots[robot].position().x, 2);
    next.close();
    next.sim!.dispose();
    back.sim!.dispose();
  });
});

describe('player record', () => {
  it('adds up finished matches', async () => {
    const { EMPTY_STATS, favouriteRobot, topRobots, withMatch } = await import('../src/stats');
    const multi = { single: false, solo: null };
    let stats = withMatch(EMPTY_STATS, { ...multi, alliance: 'red', blue: 40, red: 90, robot: 'Simbotics', solo: 50 });
    stats = withMatch(stats, { ...multi, alliance: 'blue', blue: 10, red: 30, robot: 'Simbotics', solo: 10 });
    // An older match, from before each robot's own score was kept, does not count toward the average.
    stats = withMatch(stats, { ...multi, alliance: 'blue', blue: 20, red: 20, robot: 'Cheesy Poofs' });
    stats = withMatch(stats, { alliance: 'blue', blue: 300, red: 0, robot: 'Cheesy Poofs', single: true, solo: null });
    stats = withMatch(stats, { alliance: 'blue', blue: 120, red: 0, robot: 'Simbotics', single: true, solo: null });
    expect(stats).toMatchObject({ matches: 3, wins: 1, losses: 1, ties: 1, bestScore: 90, totalScore: 120 });
    expect(stats).toMatchObject({ soloTotal: 60, soloMatches: 2, singleMatches: 2, singleBest: 300 });
    expect(topRobots(stats)).toEqual([
      ['Simbotics', 3],
      ['Cheesy Poofs', 2],
    ]);
    expect(favouriteRobot(stats)).toBe('Simbotics');
    expect(favouriteRobot(EMPTY_STATS)).toBeNull();
  });
});

describe("each robot's own score", () => {
  beforeAll(() => initPhysics());

  it('credits fuel to the robot that shot it, and reaches other players', () => {
    // Without an outpost, so the human player's fuel does not land in the hub too.
    const sim = buildNetWorld({ ...setup(), options: { outpost: false } });
    const match = sim.match!;
    // Past the countdown, so the field is live.
    for (let i = 0; i < 190; i++) sim.step([]);
    const goal = sim.game.goals!.find((g) => g.alliance === 'blue')!;
    const drop = (piece: number) =>
      sim.pieces.release(piece, { x: (goal.min[0] + goal.max[0]) / 2, y: goal.max[1] - 0.05, z: (goal.min[2] + goal.max[2]) / 2 }, { x: 0, y: 0, z: 0 });
    // The blue robot's preload counts for it; a loose piece that falls in counts for nobody.
    const mine = sim.robots[0].takePiece()!;
    drop(mine);
    const loose = sim.pieces.heldBy.indexOf(-1);
    for (let i = 0; i < 90; i++) sim.step([]);
    drop(loose);
    for (let i = 0; i < 90; i++) sim.step([]);
    expect(match.score('blue')).toBe(2);
    expect(match.solo[0]).toBe(1);
    expect(match.solo[1] ?? 0).toBe(0);
    sim.dispose();
  });
});

describe('joining after a match', () => {
  beforeAll(() => initPhysics());

  it('a player who joins once a match is over is not sent it, and plays the next one', () => {
    const host = new HostSession('Host', poofs());
    const sim = host.start('rebuilt-2026', {}, 'practice', 3);
    sim.match!.finished = true;
    const [hostEnd, clientEnd] = loopback();
    host.accept(hostEnd);
    const late = new ClientSession(clientEnd, 'Late', simbotics());
    let started = 0;
    late.onStart = () => started++;
    // Stepping the finished match a little while, as the host's game does.
    for (let i = 0; i < 6; i++) host.step(NEUTRAL_INPUT);
    expect(late.sim).toBeNull();
    expect(started).toBe(0);
    expect(host.players.find((player) => player.id === late.id)!.seat).not.toBeNull();
    const next = host.start('rebuilt-2026', {}, 'practice', 4);
    expect(started).toBe(1);
    expect(late.robotIndex).toBeGreaterThanOrEqual(0);
    for (let i = 0; i < 60; i++) {
      late.sendInput(input({ driveY: -1 }));
      host.step(NEUTRAL_INPUT);
    }
    const robot = late.robotIndex;
    expect(late.sim!.robots[robot].position().x).toBeCloseTo(next.robots[robot].position().x, 2);
    host.close();
    sim.dispose();
    next.dispose();
  });
});

describe('room notes in the chat', () => {
  it('tells everyone when players join or leave, the host changes a setting, or the host changes', () => {
    const host = new HostSession('Host', poofs());
    const join = (name: string) => {
      const [hostEnd, clientEnd] = loopback();
      host.accept(hostEnd);
      return new ClientSession(clientEnd, name, simbotics());
    };
    const ana = join('Ana');
    const ben = join('Ben');
    host.setSettings({ robotRights: 'captain', mode: 'practice' });
    host.setSettings({ listed: false });
    host.kick(ben.id!);
    const notes = () => ana.chat.filter((line) => line.system).map((line) => line.text);
    expect(notes()).toEqual([
      'Ana joined the room.',
      'Ben joined the room.',
      'The host changed the room so player 1 of each alliance picks robots for their alliance.',
      'The host set the match to free practice, with no clock.',
      'The host took the room off the open matches list.',
      'Ben was removed from the room by the host.',
    ]);
    // Players' own messages are not notes.
    ana.request({ type: 'chat', text: 'hi' });
    expect(ana.chat.at(-1)).toEqual({ from: ana.id, name: 'Ana', text: 'hi' });

    // The host leaves: Ana takes over, and Ben's rejoining copy shows the chat once, with the change of host.
    const carry = { ...ana.room!, players: ana.room!.players.filter((p) => p.id !== ana.room!.hostId) };
    host.close();
    const next = new HostSession('Ana', simbotics(), undefined, { myId: ana.id!, oldHost: 'Host', room: { ...carry, hostId: -1 }, chat: ana.chat, sim: null, setup: null });
    const [hostEnd, clientEnd] = loopback();
    next.accept(hostEnd);
    const back = new ClientSession(clientEnd, 'Cy', simbotics());
    const texts = back.chat.map((line) => line.text);
    expect(texts.slice(-3)).toEqual(['Host left the room.', 'Ana is now the host.', 'Cy joined the room.']);
    expect(new Set(texts).size).toBe(texts.length);
    next.close();
  });
});

describe('ranking points from a match', () => {
  it('3 for a win, 1 for a tie, and 1 for each bonus, recorded with the match', async () => {
    const { matchRankingPoints, rankingPoints } = await import('../src/pass/pass');
    const { EMPTY_STATS, withMatch } = await import('../src/stats');
    expect(matchRankingPoints(700, 500, 1)).toBe(4);
    expect(matchRankingPoints(500, 500, 0)).toBe(1);
    expect(matchRankingPoints(400, 1000, 3)).toBe(3);
    let stats = withMatch(EMPTY_STATS, { alliance: 'blue', blue: 700, red: 500, robot: 'X', single: false, solo: 10, bonusRp: 1 });
    stats = withMatch(stats, { alliance: 'red', blue: 400, red: 1000, robot: 'X', single: false, solo: 10, bonusRp: 3 });
    stats = withMatch(stats, { alliance: 'blue', blue: 90, red: 0, robot: 'X', single: true, solo: null });
    expect(rankingPoints(stats)).toBe(4 + 6 + 1);
  });
});
