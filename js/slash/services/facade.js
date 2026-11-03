import { rpcClient as defaultClient } from '../../p2p/rpc-client.js';

/**
 * Build a frozen slash service facade over a JSON-RPC client. Each method maps
 * its arguments to the worker's request params and forwards the named method.
 */
function createRpcFacade({ client = defaultClient, label, methods }) {
  if (!client || typeof client.request !== 'function') throw new TypeError(`${label} RPC client is required`);
  const facade = {};
  for (const [name, { rpc, params }] of Object.entries(methods)) {
    facade[name] = (...args) => client.request(rpc, params(...args));
  }
  return Object.freeze(facade);
}

export { createRpcFacade };
