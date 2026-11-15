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
      alliance: id % 2 ? ('red' as const) : ('blue' as const),
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

  it('six robots start apart from each other, each with its preload', () => {
    const sim = buildNetWorld(setup(6));
    const start = sim.robots.map((robot) => robot.position());
    for (let i = 0; i < 60; i++) sim.step([]);
    sim.robots.forEach((robot, i) => {
      expect(robot.held.length).toBe(8);
      expect(Math.hypot(robot.position().x - start[i].x, robot.position().z - start[i].z)).toBeLessThan(0.02);
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
    for (let tick = 1; tick <= 240; tick++) {
      host.step(tick < 180 ? drive : []);
      if (tick % 2) continue;
      const snapshot = writer.write(host, tick);
      if (tick === 2) expect(snapshot.byteLength).toBeGreaterThan(4000);
      if (tick === 4) quiet = snapshot.byteLength;
      reader.apply(copy, snapshot);
    }

    expect(reader.tick).toBe(240);
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
    expect(client.players.map((player) => player.alliance)).toEqual(['blue', 'red']);
    expect(client.players[1].name).toBe('Guest with a very lo');

    // The guest asks to change sides and back; the host could do the same for anyone.
    client.chooseAlliance('blue');
    expect(host.players[1].alliance).toBe('blue');
    host.setAlliance(1, 'red');
    expect(client.players[1].alliance).toBe('red');

    const sim = host.start('rebuilt-2026', {}, 'match', 3);
    expect(client.robotIndex).toBe(1);
    const copy = client.sim!;
    const start = copy.robots[1].position();
    for (let tick = 0; tick < 120; tick++) {
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

    // A player who drops out mid-match leaves their robot standing.
    client.close();
    host.step(NEUTRAL_INPUT);
    expect(host.players.length).toBe(2);
    host.close();
  });

  it('turns away players it cannot take', () => {
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
    expect(join(poofs(), PROTOCOL + 1)).toMatch(/version/);
    expect(join('not a robot')).toMatch(/robot/);
    for (let i = 0; i < 5; i++) expect(join(poofs())).toBe('');
    expect(host.players.filter((player) => player.alliance === 'red').length).toBe(3);
    expect(join(poofs())).toMatch(/full/);
    host.start('rebuilt-2026', {}, 'practice');
    host.close();
  });
});

describe('player record', () => {
  it('adds up finished matches', async () => {
    const { EMPTY_STATS, favouriteRobot, withMatch } = await import('../src/stats');
    let stats = withMatch(EMPTY_STATS, { alliance: 'red', blue: 40, red: 90, robot: 'Simbotics' });
    stats = withMatch(stats, { alliance: 'blue', blue: 10, red: 30, robot: 'Simbotics' });
    stats = withMatch(stats, { alliance: 'blue', blue: 20, red: 20, robot: 'Cheesy Poofs' });
    expect(stats).toMatchObject({ matches: 3, wins: 1, losses: 1, ties: 1, bestScore: 90, totalScore: 120 });
    expect(favouriteRobot(stats)).toBe('Simbotics');
    expect(favouriteRobot(EMPTY_STATS)).toBeNull();
  });
});
