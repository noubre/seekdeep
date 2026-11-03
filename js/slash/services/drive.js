import { createRpcFacade } from './facade.js';

function createDriveService(client) {
  return createRpcFacade({
    client,
    label: 'Drive',
    methods: {
      create: { rpc: 'drive.create', params: (name) => ({ name }) },
      open: { rpc: 'drive.open', params: (key, name) => (name === undefined ? { key } : { key, name }) },
      list: { rpc: 'drive.list', params: () => ({}) },
      status: { rpc: 'drive.status', params: (ref) => ({ ref }) },
      put: { rpc: 'drive.put', params: (ref, path, content) => ({ ref, path, content }) },
      get: { rpc: 'drive.get', params: (ref, path) => ({ ref, path }) },
      files: { rpc: 'drive.files', params: (ref, prefix) => (prefix === undefined ? { ref } : { ref, prefix }) },
      del: { rpc: 'drive.del', params: (ref, path) => ({ ref, path }) },
      close: { rpc: 'drive.close', params: (ref) => ({ ref }) }
    }
  });
}
export { createDriveService };
