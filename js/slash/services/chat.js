/**
 * Chat slash service: exposes room lifecycle/status over the worker RPC,
 * mirroring the resource slash services.
 */
import { rpcClient } from '../../p2p/rpc-client.js';

function createChatSlashService(client = rpcClient) {
  if (!client || typeof client.request !== 'function') throw new TypeError('Chat RPC client is required');
  return Object.freeze({
    status: () => client.request('chat.status', {}),
    peers: () => client.request('chat.peers', {}),
    create: () => client.request('chat.create', {}),
    join: (topic) => client.request('chat.join', { topic }),
    leave: () => client.request('chat.leave', {})
  });
}

const chatService = createChatSlashService();

export { createChatSlashService, chatService };