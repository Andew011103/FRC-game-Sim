import { expect, it } from 'vitest';
import { asJson } from '../src/net/peer';
it('reads the list as Metered shows it', () => {
  const shown = '[{urls: "stun:stun.relay.metered.ca:80",},{urls: "turn:global.relay.metered.ca:80",username: "u1",credential: "p1",},{urls: "turns:global.relay.metered.ca:443?transport=tcp",username: "u1",credential: "p1",},]';
  const list = JSON.parse(asJson(shown));
  expect(list).toHaveLength(3);
  expect(list[1]).toEqual({ urls: 'turn:global.relay.metered.ca:80', username: 'u1', credential: 'p1' });
});
