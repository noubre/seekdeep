import test from 'brittle';
import { Duplex } from 'node:stream';
import { createJsonRpcServer, createResourceRpcMethods } from '../js/p2p/rpc-server.js';
import { createRpcClient } from '../js/p2p/rpc-client.js';

function duplexPair() {
  let a;
  let b;
  a = new Duplex({ read() {}, write(chunk, _encoding, callback) { b.push(Buffer.from(chunk)); callback(); } });
  b = new Duplex({ read() {}, write(chunk, _encoding, callback) { a.push(Buffer.from(chunk)); callback(); } });
  return [a, b];
}

test('Localdrive RPC methods are allowlisted and exactly validated', async function (t) {
  const calls = [];
  const localdrive = {
    add: async (...args) => { calls.push(['add', ...args]); return { ok: true }; },
    list: async () => { calls.push(['list']); return []; },
    status: async (...args) => { calls.push(['status', ...args]); return { ok: true }; },
    files: async (...args) => { calls.push(['files', ...args]); return { files: [], capped: false }; },
    get: async (...args) => { calls.push(['get', ...args]); return { content: '' }; },
    put: async (...args) => { calls.push(['put', ...args]); return { ok: true }; },
    remove: async (...args) => { calls.push(['remove', ...args]); return { ok: true }; }
  };
  const [clientPipe, serverPipe] = duplexPair();
  const server = createJsonRpcServer(serverPipe, createResourceRpcMethods({ drive: {}, localdrive }));
  const client = createRpcClient({ pipeFactory: () => clientPipe, timeout: 1000 });
  t.teardown(async () => { client.close(); await server.close(); });

  await client.request('localdrive.add', { name: 'docs', root: '@storage/docs', writable: true });
  await client.request('localdrive.list', {});
  await client.request('localdrive.status', { ref: 'docs' });
  await client.request('localdrive.files', { ref: 'docs', prefix: '/x' });
  await client.request('localdrive.get', { ref: 'docs', path: '/x' });
  await client.request('localdrive.put', { ref: 'docs', path: '/x', content: '' });
  await client.request('localdrive.remove', { ref: 'docs' });
  t.alike(calls, [
    ['add', 'docs', '@storage/docs', true], ['list'], ['status', 'docs'], ['files', 'docs', '/x'],
    ['get', 'docs', '/x'], ['put', 'docs', '/x', ''], ['remove', 'docs']
  ]);

  await t.exception.all(() => client.request('localdrive.add', { name: 'x', root: '@storage/x', writable: 'yes' }), /writable.*boolean/i);
  await t.exception.all(() => client.request('localdrive.list', { extra: true }), /unsupported field/i);
  await t.exception.all(() => client.request('localdrive.remove', {}), /ref.*non-empty/i);
});

test('Localdrive RPC redacts filesystem errors and returns operation-specific safe codes', async function (t) {
  const configuredPath = '/Users/private/seekdeep-localdrives-v1/docs';
  const error = new Error(`EACCES: permission denied, open '${configuredPath}'`);
  error.code = 'EACCES';
  const localdrive = { get: async () => { throw error; } };
  const [clientPipe, serverPipe] = duplexPair();
  const server = createJsonRpcServer(serverPipe, createResourceRpcMethods({ drive: {}, localdrive }));
  const client = createRpcClient({ pipeFactory: () => clientPipe, timeout: 1000 });
  t.teardown(async () => { client.close(); await server.close(); });

  const result = await Promise.allSettled([client.request('localdrive.get', { ref: 'docs', path: '/x' })]);
  t.is(result[0].status, 'rejected');
  t.is(result[0].reason.code, 'LOCALDRIVE_GET_FAILED');
  t.is(result[0].reason.message, 'Localdrive get failed');
  t.absent(String(result[0].reason.stack).includes(configuredPath));
});
