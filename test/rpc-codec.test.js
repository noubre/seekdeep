import test from 'brittle';
import { Duplex } from 'node:stream';
import { createJsonRpcServer } from '../js/p2p/rpc-server.js';
import { createRpcClient } from '../js/p2p/rpc-client.js';
import { hasSafeErrorCode } from '../js/p2p/rpc-codec.js';

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
  'drive.get': {
    validate: (params) => [params.ref],
    invoke: async (ref) => ({ ref, text: 'é'.repeat(50) })
  }
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

test('renderer client decodes split multibyte and coalesced event frames', async function (t) {
  const [clientPipe, serverPipe] = duplexPair();
  const server = createJsonRpcServer(serverPipe, methods);
  const client = createRpcClient({ pipeFactory: () => clientPipe, timeout: 1000 });
  t.teardown(async () => { client.close(); await server.close(); });

  const received = [];
  client.on('chat.event', (data) => received.push(data));
  await client.request('drive.get', { ref: 'warmup' });

  const first = Buffer.from(`${JSON.stringify({ event: 'chat.event', data: { text: 'héllo' } })}\n`);
  const second = Buffer.from(`${JSON.stringify({ event: 'chat.event', data: { text: 'wörld' } })}\n`);
  const multibyteStart = first.indexOf(Buffer.from('é')[0]);
  t.ok(multibyteStart > 0, 'multibyte character exists in the first frame');
  const splitAt = multibyteStart + 1;
  serverPipe.write(first.subarray(0, splitAt));
  serverPipe.write(Buffer.concat([first.subarray(splitAt), second]));

  await waitFor(() => received.length === 2);
  t.alike(received, [{ text: 'héllo' }, { text: 'wörld' }], 'exactly two coalesced frames decode');
});

test('renderer client measures frame limits in UTF-8 bytes, not characters', async function (t) {
  const [clientPipe, serverPipe] = duplexPair();
  const server = createJsonRpcServer(serverPipe, methods);
  const client = createRpcClient({ pipeFactory: () => clientPipe, timeout: 1000, maxMessageBytes: 256 });
  t.teardown(async () => { client.close(); await server.close(); });

  t.alike(await client.request('drive.get', { ref: 'docs' }), {
    ref: 'docs',
    text: 'é'.repeat(50)
  }, 'multibyte payload under the byte limit succeeds');

  const oversized = `${JSON.stringify({ id: 'x', ok: true, result: 'é'.repeat(120) })}\n`;
  t.ok(Buffer.byteLength(oversized) > 256, 'frame exceeds the limit in bytes');
  t.ok(oversized.length < Buffer.byteLength(oversized), 'frame is under the limit in characters');
  serverPipe.write(Buffer.from(oversized));
  await waitFor(() => clientPipe.destroyed);
  t.ok(clientPipe.destroyed, 'the byte limit is enforced, not the character count');
});

test('coded-error allowlist accepts only the worker wrappers prefixes', function (t) {
  for (const code of ['LOCALDRIVE_READ_ONLY', 'LOCALDRIVE_GET_FAILED', 'MIRROR_START_FAILED', 'MIRROR_']) {
    t.ok(hasSafeErrorCode(code), `${code} is forwardable`);
  }
  for (const code of [undefined, null, '', 'DRIVE_PUT_FAILED', 'LOCALDRIVE', 'localdrive_read_only', 'MIRRORX_FAILED', 42]) {
    t.absent(hasSafeErrorCode(code), `${String(code)} is not forwardable`);
  }
});

test('only allowlisted error codes reach the renderer', async function (t) {
  const [clientPipe, serverPipe] = duplexPair();
  const codedMethods = {
    'drive.get': {
      validate: () => [],
      invoke: async () => { const error = new Error('plain failure'); error.code = 'DRIVE_PUT_FAILED'; throw error; }
    },
    'drive.list': {
      validate: () => [],
      invoke: async () => { const error = new Error('Localdrive mapping is read-only'); error.code = 'LOCALDRIVE_READ_ONLY'; throw error; }
    }
  };
  const server = createJsonRpcServer(serverPipe, codedMethods);
  const client = createRpcClient({ pipeFactory: () => clientPipe, timeout: 1000 });
  t.teardown(async () => { client.close(); await server.close(); });

  const capture = async (method) => {
    try {
      await client.request(method, {});
      return null;
    } catch (error) {
      return error;
    }
  };

  const unlisted = await capture('drive.get');
  t.is(unlisted.message, 'plain failure', 'the message survives without its code');
  t.is(unlisted.code, undefined, 'a code outside the allowlist is not forwarded');

  const listed = await capture('drive.list');
  t.is(listed.code, 'LOCALDRIVE_READ_ONLY', 'an allowlisted code is forwarded');
  t.is(listed.message, 'Localdrive mapping is read-only');
});
