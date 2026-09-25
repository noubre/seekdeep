import { rpcClient } from '../../p2p/rpc-client.js';

function createLocaldriveService(client = rpcClient) {
  if (!client || typeof client.request !== 'function') throw new TypeError('Localdrive RPC client is required');
  return Object.freeze({
    add: (name, root, writable = false) => client.request('localdrive.add', { name, root, writable }),
    list: () => client.request('localdrive.list', {}),
    status: (ref) => client.request('localdrive.status', { ref }),
    files: (ref, prefix) => client.request('localdrive.files', prefix === undefined ? { ref } : { ref, prefix }),
    get: (ref, path) => client.request('localdrive.get', { ref, path }),
    put: (ref, path, content) => client.request('localdrive.put', { ref, path, content }),
    remove: (ref) => client.request('localdrive.remove', { ref })
  });
}

const localdriveService = createLocaldriveService();

export { createLocaldriveService, localdriveService };
