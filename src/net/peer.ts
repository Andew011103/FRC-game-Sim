import { Peer, type DataConnection } from 'peerjs';
import type { Transport } from './protocol';

// Players connect straight to the host's browser. A free public service
// (PeerJS's) only introduces them: it is told a room code, nothing about the
// players, and no game data passes through it.

const ROOM_PREFIX = 'drive-practice-room-';
/** No I or O, which read as 1 and 0. */
const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
export const CODE_LENGTH = 5;
const CONNECT_SECONDS = 15;

/**
 * How two browsers find a way to reach each other. A STUN server tells each
 * browser its public address, which is enough on most home networks. When a
 * network will not allow a direct link, the browsers need a TURN server to
 * relay their traffic. PeerJS's own free relay is no longer reachable, so a
 * relay is used only when one is set up: either VITE_ICE_SERVERS, the list
 * of servers exactly as a relay service such as Metered shows it, or
 * VITE_TURN_URLS (comma separated) with VITE_TURN_USERNAME and
 * VITE_TURN_CREDENTIAL.
 */
export function iceServers(): RTCIceServer[] {
  const servers: RTCIceServer[] = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];
  const list = configuredList();
  if (list) return [...servers, ...list];
  const urls = (import.meta.env.VITE_TURN_URLS as string | undefined)?.split(',').map((url) => url.trim()).filter(Boolean);
  if (urls?.length) {
    servers.push({
      urls,
      username: import.meta.env.VITE_TURN_USERNAME as string | undefined,
      credential: import.meta.env.VITE_TURN_CREDENTIAL as string | undefined,
    });
  }
  return servers;
}

/**
 * The list as a relay service shows it, made into strict JSON: Metered, for
 * one, shows it as JavaScript, with unquoted names and trailing commas.
 */
export function asJson(text: string): string {
  return text
    .trim()
    .replace(/([{,]\s*)(urls|username|credential)\s*:/g, '$1"$2":')
    .replace(/,\s*([}\]])/g, '$1');
}

/** The relay service's own list of servers, if one is set up that way. */
function configuredList(): RTCIceServer[] | null {
  const text = import.meta.env.VITE_ICE_SERVERS as string | undefined;
  if (!text) return null;
  try {
    const parsed: unknown = JSON.parse(asJson(text));
    if (!Array.isArray(parsed)) return null;
    return parsed.filter(
      (server): server is RTCIceServer =>
        !!server && (typeof server.urls === 'string' || (Array.isArray(server.urls) && server.urls.every((url: unknown) => typeof url === 'string'))),
    );
  } catch {
    console.warn('VITE_ICE_SERVERS is not a list of servers; no relay is used.');
    return null;
  }
}

/** Whether a relay is set up for players whose networks will not link directly. */
export const relayAvailable = Boolean(import.meta.env.VITE_TURN_URLS || configuredList()?.some((server) => [server.urls].flat().some((url) => url.startsWith('turn'))));

const peerOptions = () => ({ config: { iceServers: iceServers() } });

const newCode = (): string =>
  Array.from({ length: CODE_LENGTH }, () => LETTERS[Math.floor(Math.random() * LETTERS.length)]).join('');

/** What a player types, tidied into a room code. */
export const cleanCode = (typed: string): string =>
  typed
    .toUpperCase()
    .replace(/[^A-Z]/g, '')
    .slice(0, CODE_LENGTH);

function transportFor(connection: DataConnection): Transport {
  const transport: Transport = {
    onMessage: null,
    onClose: null,
    send: (data) => {
      if (connection.open) connection.send(data);
    },
    close: () => connection.close(),
  };
  connection.on('data', (data) => {
    if (typeof data === 'string' || data instanceof ArrayBuffer) transport.onMessage?.(data);
    else if (ArrayBuffer.isView(data)) {
      transport.onMessage?.(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer);
    }
  });
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    transport.onClose?.();
  };
  connection.on('close', close);
  connection.on('error', close);
  return transport;
}

export interface Link {
  code: string;
  close(): void;
}

const explain = (error: { type?: string }): string =>
  error.type === 'peer-unavailable'
    ? 'There is no match with that code.'
    : error.type === 'browser-incompatible'
      ? 'This browser cannot connect to other players.'
      : 'Could not reach the service that connects players. Check your connection and try again.';

/** The error when a room's code is still held by someone else, such as a host who has only just left. */
export const CODE_TAKEN = 'That room code is in use.';

/**
 * Opens a room other players can join by its code: a new code, or a given
 * one when taking a room over from a host who left. A given code that is
 * still in use fails with CODE_TAKEN.
 */
export function openRoom(onPlayer: (transport: Transport) => void, attempt = 0, given?: string): Promise<Link> {
  return new Promise((resolve, reject) => {
    const code = given ?? newCode();
    const peer = new Peer(ROOM_PREFIX + code, peerOptions());
    let opened = false;
    peer.on('open', () => {
      opened = true;
      resolve({ code, close: () => peer.destroy() });
    });
    peer.on('connection', (connection) => {
      // The connection can report itself open more than once; the player is taken in once.
      let taken = false;
      const take = () => {
        if (taken) return;
        taken = true;
        onPlayer(transportFor(connection));
      };
      if (connection.open) take();
      else connection.on('open', take);
    });
    peer.on('error', (error) => {
      if (opened) return;
      peer.destroy();
      // Another room already has this code: try another.
      if (error.type === 'unavailable-id' && given) reject(new Error(CODE_TAKEN));
      else if (error.type === 'unavailable-id' && attempt < 5) openRoom(onPlayer, attempt + 1).then(resolve, reject);
      else reject(new Error(explain(error)));
    });
  });
}

/** Connects to the room with a code. */
export function joinRoom(code: string, seconds = CONNECT_SECONDS): Promise<{ transport: Transport; link: Link }> {
  return new Promise((resolve, reject) => {
    const peer = new Peer(peerOptions());
    let settled = false;
    const fail = (message: string) => {
      if (settled) return;
      settled = true;
      peer.destroy();
      reject(new Error(message));
    };
    const timer = setTimeout(
      () =>
        fail(
          relayAvailable
            ? 'Could not connect to that match. Check your connection and try again.'
            : 'Could not connect to that match: your network and the host’s cannot link directly. Players on the same network, or behind strict routers, need a relay server.',
        ),
      seconds * 1000,
    );
    peer.on('error', (error) => fail(explain(error)));
    peer.on('open', () => {
      const connection = peer.connect(ROOM_PREFIX + code, { reliable: true, serialization: 'raw' });
      connection.on('open', () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ transport: transportFor(connection), link: { code, close: () => peer.destroy() } });
      });
    });
  });
}
