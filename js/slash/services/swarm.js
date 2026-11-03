/**
 * Swarm slash service: thin adapter over the chat worker RPC.
 * All data-plane work happens in the Bare worker.
 */
import { rpcClient } from '../../p2p/rpc-client.js';

const MAX_DISPLAY_NAME_LENGTH = 64;
const MAX_PEERS = 50;

function normalizeText(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .replace(/[\p{Cc}\p{Cf}]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function truncateIdentifier(value) {
  const identifier = normalizeText(value) || 'unknown';
  return identifier.length > 8 ? `${identifier.slice(0, 8)}…` : identifier;
}

function sanitizeDisplayName(value, peerId) {
  const normalized = normalizeText(value);
  if (!normalized) return `Peer ${truncateIdentifier(peerId)}`;
  return Array.from(normalized).slice(0, MAX_DISPLAY_NAME_LENGTH).join('');
}

function statusShape(status) {
  return {
    initialized: Boolean(status?.initialized),
    topic: status?.topic || null,
    role: status?.role || 'none',
    connected: Boolean(status?.connected),
    peerCount: Number.isSafeInteger(status?.peerCount) ? status.peerCount : 0
  };
}

function createSwarmService(client = rpcClient) {
  if (!client || typeof client.request !== 'function') throw new TypeError('Swarm RPC client is required');

  async function status() {
    return statusShape(await client.request('chat.status', {}));
  }

  return Object.freeze({
    status,
    async create() {
      await client.request('chat.create', {});
      return status();
    },
    async join(topic) {
      await client.request('chat.join', { topic });
      return status();
    },
    async leave() {
      await client.request('chat.leave', {});
      return status();
    },
    async peers() {
      const result = await client.request('chat.peers', {});
      const peers = Array.isArray(result?.peers) ? result.peers : [];
      return peers.slice(0, MAX_PEERS).map((peer) => ({
        id: truncateIdentifier(peer.id),
        displayName: sanitizeDisplayName(peer.displayName, peer.id),
        role: peer.role === 'host' ? 'host' : 'peer'
      }));
    }
  });
}
export { createSwarmService };