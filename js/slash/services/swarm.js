import {
  initializeNewChat,
  joinExistingChat,
  leaveExistingChat,
  isSwarmInitialized,
  getTopicHex,
  isConnectedToPeers
} from '../../network/hyperswarm.js';
import { isSessionHost } from '../../session/modes.js';
import { getActivePeers } from '../../session/peers.js';

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

function createSwarmService(dependencies) {
  const {
    initializeNewChat,
    joinExistingChat,
    leaveExistingChat,
    isSwarmInitialized,
    getTopicHex,
    isConnectedToPeers,
    isSessionHost,
    getActivePeers
  } = dependencies;

  function status() {
    const initialized = Boolean(isSwarmInitialized());
    const topic = initialized ? getTopicHex() : null;
    const activePeers = getActivePeers();
    const peerCount = initialized && activePeers instanceof Map ? activePeers.size : 0;
    const activeTopic = typeof topic === 'string' && topic.length > 0 ? topic : null;

    return {
      initialized,
      topic: activeTopic,
      role: activeTopic ? (isSessionHost() ? 'host' : 'joiner') : 'none',
      connected: initialized && Boolean(isConnectedToPeers()),
      peerCount
    };
  }

  function runTransition(operation, failureMessage) {
    try {
      if (operation() === false) throw new Error(failureMessage);
      return status();
    } catch (error) {
      leaveExistingChat({ announce: false });
      throw error;
    }
  }

  return Object.freeze({
    status,
    create() {
      return runTransition(
        () => initializeNewChat({ announce: false, notify: true }),
        'Failed to create swarm topic.'
      );
    },
    join(topic) {
      return runTransition(
        () => joinExistingChat(topic, { announce: false, notify: true }),
        'Failed to join swarm topic.'
      );
    },
    leave() {
      leaveExistingChat();
      return status();
    },
    peers() {
      const activePeers = getActivePeers();
      if (!(activePeers instanceof Map)) return [];

      const peers = [];
      for (const [peerId, peerInfo = {}] of activePeers) {
        if (peers.length >= MAX_PEERS) break;
        peers.push({
          id: truncateIdentifier(peerId),
          displayName: sanitizeDisplayName(peerInfo.displayName, peerId),
          role: peerInfo.isHost || peerInfo.isServer ? 'host' : 'peer'
        });
      }
      return peers;
    }
  });
}

const swarmService = createSwarmService({
  initializeNewChat,
  joinExistingChat,
  leaveExistingChat,
  isSwarmInitialized,
  getTopicHex,
  isConnectedToPeers,
  isSessionHost,
  getActivePeers
});

export { createSwarmService, swarmService };
