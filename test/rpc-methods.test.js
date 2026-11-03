import test from 'brittle';
import { Duplex } from 'node:stream';
import { createResourceRpcMethods, createJsonRpcServer } from '../js/p2p/rpc-server.js';
import { createRpcClient } from '../js/p2p/rpc-client.js';
import { RPC_METHOD_NAMES } from '../js/p2p/rpc-methods.js';

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

function stubServices() {
  const chatMethods = {};
  for (const name of ['chat.status', 'chat.create', 'chat.join', 'chat.leave', 'chat.peers', 'chat.send', 'chat.setMode', 'chat.refreshModels', 'chat.setProvider']) {
    chatMethods[name] = async () => ({ handled: name });
  }
  return {
    drive: {},
    localdrive: {},
    mirror: { start: async () => ({}), status: async () => ({}), stop: async () => ({}) },
    beam: { create: async () => ({}), join: async () => ({}), list: async () => [], status: async () => ({}), send: async () => ({}), receive: async () => ({}), closeBeam: async () => ({}) },
    chat: { methods: chatMethods },
    harness: { dispatch: async () => true, runtime: { list: () => [] } }
  };
}

test('the shared method-name list and the server tables cover each other exactly', function (t) {
  const names = new Set(RPC_METHOD_NAMES);
  const serverKeys = Object.keys(createResourceRpcMethods(stubServices()));

  for (const key of serverKeys) {
    t.ok(names.has(key), `server method ${key} is present in RPC_METHOD_NAMES`);
  }
  for (const name of names) {
    t.ok(serverKeys.includes(name), `allowlisted method ${name} is served by the method tables`);
  }
  t.is(serverKeys.length, names.size, 'the tables produce exactly the allowlisted method names');
  t.ok(names.has('slash.list'), 'slash.list is allowlisted');
  t.ok(names.has('slash.dispatch'), 'slash.dispatch is allowlisted');
  t.ok(names.has('chat.status'), 'chat.status is allowlisted (renderer chat path regression guard)');
  t.is(new Set(RPC_METHOD_NAMES).size, RPC_METHOD_NAMES.length, 'no duplicate method names');
});

test('client accepts chat.status and reaches the server round-trip', async function (t) {
  const [clientPipe, serverPipe] = duplexPair();
  const services = stubServices();
  const server = createJsonRpcServer(serverPipe, createResourceRpcMethods(services));
  const client = createRpcClient({ pipeFactory: () => clientPipe, timeout: 1000 });
  t.teardown(async () => { client.close(); await server.close(); });

  const result = await client.request('chat.status', {});
  t.alike(result, { handled: 'chat.status' }, 'chat.status is no longer rejected by the client allowlist');
});
