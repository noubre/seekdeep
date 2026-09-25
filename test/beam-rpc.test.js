import test from 'brittle';
import { Duplex } from 'node:stream';
import { createJsonRpcServer, createResourceRpcMethods } from '../js/p2p/drive-rpc-server.js';
import { createDriveRpcClient } from '../js/p2p/drive-rpc-client.js';
import { createBeamService as createBeamRpcService } from '../js/slash/services/beam.js';

function duplexPair() {
  let a;
  let b;
  a = new Duplex({ read() {}, write(chunk, _encoding, callback) { b.push(Buffer.from(chunk)); callback(); } });
  b = new Duplex({ read() {}, write(chunk, _encoding, callback) { a.push(Buffer.from(chunk)); callback(); } });
  return [a, b];
}

test('beam RPC exposes only JSON-safe lifecycle methods with strict validation', async function (t) {
  const calls = [];
  const beam = {
    create: async (...args) => { calls.push(['create', ...args]); return { descriptor: { id: 'beam-1', name: args[0], status: 'connecting', connected: false, pending: 0, sentMessages: 0, sentBytes: 0, receivedMessages: 0, receivedBytes: 0 }, key: 'a'.repeat(52) }; },
    join: async (...args) => { calls.push(['join', ...args]); return { id: 'beam-2', name: args[0], status: 'connecting', connected: false, pending: 0, sentMessages: 0, sentBytes: 0, receivedMessages: 0, receivedBytes: 0 }; },
    list: async () => { calls.push(['list']); return []; },
    status: async (...args) => { calls.push(['status', ...args]); return { id: 'beam-1' }; },
    send: async (...args) => { calls.push(['send', ...args]); return { id: 'beam-1', bytes: 2 }; },
    receive: async (...args) => { calls.push(['receive', ...args]); return { messages: [], bytes: 0, pending: 0 }; },
    closeBeam: async (...args) => { calls.push(['close', ...args]); return { id: 'beam-1' }; }
  };
  const [clientPipe, serverPipe] = duplexPair();
  const server = createJsonRpcServer(serverPipe, createResourceRpcMethods({ drive: {}, localdrive: {}, beam }));
  const client = createDriveRpcClient({ pipeFactory: () => clientPipe, timeout: 1000 });
  t.teardown(async () => { client.close(); await server.close(); });
  const adapter = createBeamRpcService(client);

  await adapter.create('sender');
  await adapter.join('receiver', 'a'.repeat(52));
  await adapter.list();
  await adapter.status('sender');
  await adapter.send('sender', 'hi');
  await adapter.receive('receiver');
  await adapter.close('sender');
  t.alike(calls, [
    ['create', 'sender'], ['join', 'receiver', 'a'.repeat(52)], ['list'], ['status', 'sender'],
    ['send', 'sender', 'hi'], ['receive', 'receiver'], ['close', 'sender']
  ]);

  await t.exception.all(() => client.request('beam.create', { name: 'x', extra: true }), /unsupported field/i);
  await t.exception.all(() => client.request('beam.join', { name: 'x', key: 1 }), /string/i);
  await t.exception.all(() => client.request('beam.send', { ref: 'x', content: 1 }), /string/i);
});
