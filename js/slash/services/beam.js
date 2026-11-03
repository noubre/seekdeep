import { createRpcFacade } from './facade.js';

function createBeamService(client) {
  return createRpcFacade({
    client,
    label: 'Beam',
    methods: {
      create: { rpc: 'beam.create', params: (name) => ({ name }) },
      join: { rpc: 'beam.join', params: (name, key) => ({ name, key }) },
      list: { rpc: 'beam.list', params: () => ({}) },
      status: { rpc: 'beam.status', params: (ref) => ({ ref }) },
      send: { rpc: 'beam.send', params: (ref, content) => ({ ref, content }) },
      receive: { rpc: 'beam.receive', params: (ref) => ({ ref }) },
      close: { rpc: 'beam.close', params: (ref) => ({ ref }) }
    }
  });
}
export { createBeamService };
