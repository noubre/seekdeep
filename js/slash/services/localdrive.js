import { createRpcFacade } from './facade.js';

function createLocaldriveService(client) {
  return createRpcFacade({
    client,
    label: 'Localdrive',
    methods: {
      add: { rpc: 'localdrive.add', params: (name, root, writable = false) => ({ name, root, writable }) },
      list: { rpc: 'localdrive.list', params: () => ({}) },
      status: { rpc: 'localdrive.status', params: (ref) => ({ ref }) },
      files: { rpc: 'localdrive.files', params: (ref, prefix) => (prefix === undefined ? { ref } : { ref, prefix }) },
      get: { rpc: 'localdrive.get', params: (ref, path) => ({ ref, path }) },
      put: { rpc: 'localdrive.put', params: (ref, path, content) => ({ ref, path, content }) },
      remove: { rpc: 'localdrive.remove', params: (ref) => ({ ref }) }
    }
  });
}
export { createLocaldriveService };
