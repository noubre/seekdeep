import test from 'brittle';
import { Duplex } from 'node:stream';
import { createJsonRpcServer, EVENT_PATTERN } from '../js/p2p/rpc-server.js';
import { createRpcClient } from '../js/p2p/rpc-client.js';

function duplexPair() {
  let a;
  let b;
  a = new Duplex({
    read() {},
    write(chunk, _encoding, callback) { b.push(Buffer.from(chunk)); callback(); },
    final(callback) { b.push(null); callback(); }
  });
  b = new Duplex({
    read() {},
    write(chunk, _encoding, callback) { a.push(Buffer.from(chunk)); callback(); },
    final(callback) { a.push(null); callback(); }
  });
  return [a, b];
}

const methods = {
  'drive.list': { validate: () => [], invoke: async () => [{ id: 'drive-1' }] }
};

function waitFor(predicate, timeout = 1000) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const poll = () => {
      if (predicate()) return resolve();
      if (Date.now() - started > timeout) return reject(new Error('timed out waiting for condition'));
      setTimeout(poll, 5);
    };
    poll();
  });
}

test('server.notify pushes an event frame that client.on receives', async function (t) {
  const [clientPipe, serverPipe] = duplexPair();
  const server = createJsonRpcServer(serverPipe, methods);
  const client = createRpcClient({ pipeFactory: () => clientPipe, timeout: 1000 });
  t.teardown(async () => { client.close(); await server.close(); });

  const received = [];
  const unsubscribe = client.on('chat.event', (data) => received.push(data));
  t.is(typeof unsubscribe, 'function', 'on returns an unsubscribe function');

  await client.request('drive.list', {});
  await server.notify('chat.event', { type: 'peers', peers: [] });
  await waitFor(() => received.length === 1);
  t.alike(received[0], { type: 'peers', peers: [] });

  unsubscribe();
  await server.notify('chat.event', { type: 'peers', peers: [{ id: 'p1' }] });
  await new Promise((resolve) => setTimeout(resolve, 20));
  t.is(received.length, 1, 'unsubscribed handler receives nothing');
});

test('notify rejects invalid event names and non-JSON payloads', async function (t) {
  const [clientPipe, serverPipe] = duplexPair();
  const server = createJsonRpcServer(serverPipe, methods);
  const client = createRpcClient({ pipeFactory: () => clientPipe, timeout: 1000 });
  t.teardown(async () => { client.close(); await server.close(); });

  t.ok(EVENT_PATTERN.test('chat.event'));
  t.absent(EVENT_PATTERN.test('Chat.Event'));
  t.absent(EVENT_PATTERN.test('-bad'));
  t.exception.all(() => server.notify('Bad.Event', {}), /event name is invalid/i);
  t.exception.all(() => server.notify('chat.event', { value: 1n }), /JSON data/i);
});

test('a two-key frame that is not {event,data} is malformed and destroys the pipe', async function (t) {
  const [clientPipe, serverPipe] = duplexPair();
  const server = createJsonRpcServer(serverPipe, methods);
  const client = createRpcClient({ pipeFactory: () => clientPipe, timeout: 1000 });
  t.teardown(async () => { client.close(); await server.close(); });

  t.alike(await client.request('drive.list', {}), [{ id: 'drive-1' }]);
  serverPipe.write(Buffer.from(`${JSON.stringify({ event: 'x', data: {}, id: 1 })}\n`));
  await waitFor(() => clientPipe.destroyed);
  t.ok(clientPipe.destroyed, 'a three-key event frame is malformed and tears down the pipe');
});

test('an event frame with an invalid event name is dropped without disturbing pending RPC work', async function (t) {
  const [clientPipe, serverPipe] = duplexPair();
  const server = createJsonRpcServer(serverPipe, methods);
  const client = createRpcClient({ pipeFactory: () => clientPipe, timeout: 1000 });
  t.teardown(async () => { client.close(); await server.close(); });

  client.on('chat.event', () => {});
  serverPipe.write(Buffer.from(`${JSON.stringify({ event: 'unknown.event', data: { ok: true } })}\n`));
  t.alike(await client.request('drive.list', {}), [{ id: 'drive-1' }], 'pipe still usable');
});