/**
 * In-process RPC shim.
 *
 * Slash handlers run in the Bare worker and receive service facades. Those
 * facades speak the same `client.request(method, params)` shape as the renderer
 * client, so this adapter dispatches to the worker-side method table
 * (`createResourceRpcMethods`) through the shared `dispatchMethod` — identical
 * validation, no pipe, no serialization.
 */
import { dispatchMethod } from '../p2p/rpc-server.js';

function createLocalClient(methods) {
  if (!methods || typeof methods !== 'object' || Array.isArray(methods)) {
    throw new TypeError('Local client methods must be an object');
  }
  return Object.freeze({
    async request(method, params) {
      return dispatchMethod(methods, method, params ?? {});
    }
  });
}

export { createLocalClient };
