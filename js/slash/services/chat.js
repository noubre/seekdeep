/**
 * Chat slash service: exposes room lifecycle/status over the worker RPC,
 * mirroring the resource slash services.
 */
import { createRpcFacade } from './facade.js';

function createChatSlashService(client) {
  return createRpcFacade({
    client,
    label: 'Chat',
    methods: {
      status: { rpc: 'chat.status', params: () => ({}) },
      peers: { rpc: 'chat.peers', params: () => ({}) },
      create: { rpc: 'chat.create', params: () => ({}) },
      join: { rpc: 'chat.join', params: (topic) => ({ topic }) },
      leave: { rpc: 'chat.leave', params: () => ({}) }
    }
  });
}
export { createChatSlashService };
