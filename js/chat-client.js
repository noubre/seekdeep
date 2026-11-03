/**
 * Renderer-side chat client.
 *
 * Thin wrapper over the worker RPC client: exposes the `chat.*` methods and a
 * single `chat.event` subscription. All P2P/provider work happens in the Bare
 * worker; this module only speaks JSON-RPC over the Pear worker pipe.
 */
import { createRpcClient } from './p2p/rpc-client.js';
import { isSlashTag } from './slash/parser.js';

const CHAT_METHODS = Object.freeze([
  'chat.status',
  'chat.create',
  'chat.join',
  'chat.leave',
  'chat.peers',
  'chat.send',
  'chat.setMode',
  'chat.refreshModels',
  'chat.setProvider'
]);

function defaultPipeFactory() {
  const pipe = globalThis.Pear?.worker?.pipe?.();
  if (!pipe) throw new Error('Pear worker pipe is unavailable');
  return pipe;
}

function initializeChatClient(options = {}) {
  const rpc = createRpcClient({
    pipeFactory: options.pipeFactory || defaultPipeFactory,
    timeout: options.timeout
  });

  const api = {};
  for (const method of CHAT_METHODS) {
    const name = method.slice('chat.'.length);
    api[name] = (params) => rpc.request(method, params ?? {});
  }

  return Object.freeze({
    api: Object.freeze(api),
    onEvent(handler) {
      if (typeof handler !== 'function') throw new TypeError('onEvent requires a function');
      return rpc.on('chat.event', handler);
    },
    /**
     * Dispatch slash input in the worker harness. Non-slash text is short
     * circuited here so ordinary prompts never pay an RPC round trip.
     */
    dispatchSlash(text) {
      if (!isSlashTag(text)) return Promise.resolve(false);
      return rpc.request('slash.dispatch', { text }).then((result) => Boolean(result?.handled));
    },
    listSlash() {
      return rpc.request('slash.list', {});
    },
    onHarnessEvent(handler) {
      if (typeof handler !== 'function') throw new TypeError('onHarnessEvent requires a function');
      return rpc.on('harness.event', handler);
    },
    close() { rpc.close(); },
    rpc
  });
}

export { initializeChatClient, CHAT_METHODS };