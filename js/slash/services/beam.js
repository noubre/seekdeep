import { rpcClient } from '../../p2p/rpc-client.js';

function createBeamService(client = rpcClient) {
  if (!client || typeof client.request !== 'function') throw new TypeError('Beam RPC client is required');
  return Object.freeze({
    create: (name) => client.request('beam.create', { name }),
    join: (name, key) => client.request('beam.join', { name, key }),
    list: () => client.request('beam.list', {}),
    status: (ref) => client.request('beam.status', { ref }),
    send: (ref, content) => client.request('beam.send', { ref, content }),
    receive: (ref) => client.request('beam.receive', { ref }),
    close: (ref) => client.request('beam.close', { ref })
  });
}

const beamService = createBeamService();

export { createBeamService, beamService };
