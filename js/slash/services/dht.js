/**
 * DHT slash service: reads safe high-level diagnostics from the chat worker.
 */
import { rpcClient } from '../../p2p/rpc-client.js';

const HEX_KEY_PATTERN = /^[0-9a-f]{64}$/i;

function normalizeHex(value) {
  return typeof value === 'string' && HEX_KEY_PATTERN.test(value) ? value.toLowerCase() : null;
}

function normalizeConnectionCount(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function createDHTService(client = rpcClient) {
  if (!client || typeof client.request !== 'function') throw new TypeError('DHT RPC client is required');

  return Object.freeze({
    async status() {
      const status = await client.request('chat.status', {});
      const initialized = Boolean(status?.initialized);
      return {
        initialized,
        publicKey: initialized ? normalizeHex(status.publicKey) : null,
        topic: initialized ? normalizeHex(status.topic) : null,
        connectionCount: initialized ? normalizeConnectionCount(status.peerCount) : 0,
        listening: null
      };
    }
  });
}

const dhtService = createDHTService();

export { createDHTService, dhtService };