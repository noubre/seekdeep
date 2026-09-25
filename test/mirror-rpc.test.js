import test from 'brittle';
import { Duplex } from 'node:stream';
import { createJsonRpcServer, createResourceRpcMethods } from '../js/p2p/drive-rpc-server.js';
import { createDriveRpcClient } from '../js/p2p/drive-rpc-client.js';
import { createMirrorService as createMirrorRpcService } from '../js/slash/services/mirror.js';

function duplexPair() {
  let a;
  let b;
  a = new Duplex({ read() {}, write(chunk, _encoding, callback) { b.push(Buffer.from(chunk)); callback(); } });
  b = new Duplex({ read() {}, write(chunk, _encoding, callback) { a.push(Buffer.from(chunk)); callback(); } });
  return [a, b];
}

test('mirror RPC methods are exactly allowlisted and validated', async function (t) {
  const calls = [];
  const mirror = {
    start: async (...args) => { calls.push(['start', ...args]); return { id: 'mirror-1' }; },
    status: async (...args) => { calls.push(['status', ...args]); return []; },
    stop: async (...args) => { calls.push(['stop', ...args]); return { id: 'mirror-1' }; }
  };
  const [clientPipe, serverPipe] = duplexPair();
  const server = createJsonRpcServer(serverPipe, createResourceRpcMethods({ drive: {}, localdrive: {}, mirror }));
  const client = createDriveRpcClient({ pipeFactory: () => clientPipe, timeout: 1000 });
  t.teardown(async () => { client.close(); await server.close(); });
  const adapter = createMirrorRpcService(client);

  await adapter.start('docs', 'backup', { dryRun: true, prune: false, prefix: '/safe' });
  await adapter.status();
  await adapter.status('mirror-1');
  await adapter.stop('mirror-1');
  t.alike(calls, [
    ['start', 'docs', 'backup', { dryRun: true, prune: false, prefix: '/safe' }],
    ['status', undefined], ['status', 'mirror-1'], ['stop', 'mirror-1']
  ]);

  await t.exception.all(() => client.request('mirror.start', { localRef: 'a', driveRef: 'b', dryRun: true, prune: false, prefix: '/', extra: true }), /unsupported field/i);
  await t.exception.all(() => client.request('mirror.start', { localRef: 'a', driveRef: 'b', dryRun: 'yes', prune: false, prefix: '/' }), /boolean/i);
  await t.exception.all(() => client.request('mirror.status', { id: 1 }), /string/i);
  await t.exception.all(() => client.request('mirror.stop', {}), /id.*non-empty/i);
});
