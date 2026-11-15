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

/** Opens a room other players can join by its code. */
export function openRoom(onPlayer: (transport: Transport) => void, attempt = 0): Promise<Link> {
  return new Promise((resolve, reject) => {
    const code = newCode();
    const peer = new Peer(ROOM_PREFIX + code);
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
      if (error.type === 'unavailable-id' && attempt < 5) openRoom(onPlayer, attempt + 1).then(resolve, reject);
      else reject(new Error(explain(error)));
    });
  });
}

/** Connects to the room with a code. */
export function joinRoom(code: string): Promise<{ transport: Transport; link: Link }> {
  return new Promise((resolve, reject) => {
    const peer = new Peer();
    let settled = false;
    const fail = (message: string) => {
      if (settled) return;
      settled = true;
      peer.destroy();
      reject(new Error(message));
    };
    const timer = setTimeout(
      () => fail('Could not connect to that match. Some networks block direct connections between players.'),
      CONNECT_SECONDS * 1000,
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
