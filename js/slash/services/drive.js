import { driveRpcClient } from '../../p2p/drive-rpc-client.js';

function createDriveService(client = driveRpcClient) {
  if (!client || typeof client.request !== 'function') throw new TypeError('Drive RPC client is required');
  return Object.freeze({
    create: (name) => client.request('drive.create', { name }),
    open: (key, name) => client.request('drive.open', name === undefined ? { key } : { key, name }),
    list: () => client.request('drive.list', {}),
    status: (ref) => client.request('drive.status', { ref }),
    put: (ref, path, content) => client.request('drive.put', { ref, path, content }),
    get: (ref, path) => client.request('drive.get', { ref, path }),
    files: (ref, prefix) => client.request('drive.files', prefix === undefined ? { ref } : { ref, prefix }),
    del: (ref, path) => client.request('drive.del', { ref, path }),
    close: (ref) => client.request('drive.close', { ref })
  });
}

const driveService = createDriveService();

export { createDriveService, driveService };
