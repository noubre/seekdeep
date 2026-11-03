/**
 * Single source of truth for the JSON-RPC method names exchanged over the
 * worker pipe.
 *
 * The server (`createResourceRpcMethods`) only ever exposes a subset (mirror,
 * beam, chat and the harness methods appear when their services exist), but the
 * renderer client allowlist must be a superset so it never rejects a method the
 * worker is willing to serve. Keep this list in sync with the `create*RpcMethods`
 * factories in `rpc-server.js` — `rpc-server.js` asserts that invariant at
 * import time.
 *
 * `chat.request` is deliberately absent: it is in-process only, called by
 * `js/openai/backends.js` through `service.methods`, and never crosses the wire.
 */
const RPC_METHOD_NAMES = Object.freeze([
  'drive.create', 'drive.open', 'drive.list', 'drive.status', 'drive.put',
  'drive.get', 'drive.files', 'drive.del', 'drive.close',
  'localdrive.add', 'localdrive.list', 'localdrive.status', 'localdrive.files',
  'localdrive.get', 'localdrive.put', 'localdrive.remove',
  'mirror.start', 'mirror.status', 'mirror.stop',
  'beam.create', 'beam.join', 'beam.list', 'beam.status', 'beam.send', 'beam.receive', 'beam.close',
  'chat.status', 'chat.create', 'chat.join', 'chat.leave', 'chat.peers', 'chat.send',
  'chat.setMode', 'chat.refreshModels', 'chat.setProvider',
  'slash.list', 'slash.dispatch'
]);

export { RPC_METHOD_NAMES };
