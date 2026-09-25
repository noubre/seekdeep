import { rpcClient } from '../../p2p/rpc-client.js';

function createMirrorService(client = rpcClient) {
  if (!client || typeof client.request !== 'function') throw new TypeError('Mirror RPC client is required');
  return Object.freeze({
    start: (localRef, driveRef, options = {}) => client.request('mirror.start', {
      localRef,
      driveRef,
      dryRun: options.dryRun ?? true,
      prune: options.prune ?? false,
      prefix: options.prefix ?? '/'
    }),
    status: (id) => client.request('mirror.status', id === undefined ? {} : { id }),
    stop: (id) => client.request('mirror.stop', { id })
  });
}

const mirrorService = createMirrorService();

export { createMirrorService, mirrorService };
