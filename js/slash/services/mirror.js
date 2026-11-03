import { createRpcFacade } from './facade.js';

function createMirrorService(client) {
  return createRpcFacade({
    client,
    label: 'Mirror',
    methods: {
      start: {
        rpc: 'mirror.start',
        params: (localRef, driveRef, options = {}) => ({
          localRef,
          driveRef,
          dryRun: options.dryRun ?? true,
          prune: options.prune ?? false,
          prefix: options.prefix ?? '/'
        })
      },
      status: { rpc: 'mirror.status', params: (id) => (id === undefined ? {} : { id }) },
      stop: { rpc: 'mirror.stop', params: (id) => ({ id }) }
    }
  });
}
export { createMirrorService };
