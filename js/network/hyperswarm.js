/**
 * Network Hyperswarm module
 * Contains functions for managing the Hyperswarm P2P network
 */
import Hyperswarm from 'hyperswarm';
import crypto from 'hypercore-crypto';
import b4a from 'b4a';
import { addToChatHistory } from '../messages/history.js';
import { updateActivePeer, removePeer, resetPeers, getPeerInfo } from '../session/peers.js';
import { setSessionHost, isSessionHost } from '../session/modes.js';
import { setupPeerMessageHandler } from './messaging.js';

// Initialize Hyperswarm
let swarm;
let topic; // Will store current topic
let topicHex; // Will store hex representation of topic
let conns = []; // Store connections
let keyPair; // Store our key pair
let discovery; // Current topic discovery handle

/**
 * Initialize the Hyperswarm network
 */
function initializeSwarm({ swarmFactory, bootstrap } = {}) {
  if (swarm) leaveExistingChat({ announce: false });
  const options = Array.isArray(bootstrap) && bootstrap.length > 0 ? { bootstrap } : undefined;
  swarm = swarmFactory ? swarmFactory(options) : new Hyperswarm(options);
  keyPair = crypto.keyPair();
  
  // Handle new connections
  swarm.on('connection', handleNewConnection);
}

/**
 * Handle a new connection from a peer
 * @param {Object} conn - The connection object
 */
function handleNewConnection(conn) {
  const remotePublicKey = b4a.toString(conn.remotePublicKey, 'hex');
  console.log('New peer connected:', remotePublicKey);
  
  // Add to chat history and update display
  addToChatHistory({
    type: 'system',
    content: `New peer connected: ${remotePublicKey.slice(0, 8)}...`
  });
  
  // Add to connections list
  if (!conns.includes(conn)) {
    conns.push(conn);
  }
  
  // Add the peer to our active list with a default name before handshake
  updateActivePeer(remotePublicKey, {
    id: remotePublicKey,
    displayName: `Peer${remotePublicKey.slice(0, 6)}`,
    clientId: remotePublicKey,
    connectionTime: new Date()
  });
  
  // Set up message handler for this connection
  const messageHandler = setupPeerMessageHandler(conn, remotePublicKey);
  
  // Handle incoming data
  conn.on('data', data => {
    try {
      console.log(`[PEER] Received data from peer: ${remotePublicKey.slice(0, 8)}... (${data.length} bytes)`);
      messageHandler(data);
    } catch (err) {
      console.error('Error handling peer message:', err);
    }
  });
  
  // Send initial handshake with our info
  conn.write(JSON.stringify({
    type: 'handshake',
    clientId: b4a.toString(swarm.keyPair.publicKey, 'hex'),
    displayName: 'You', // This will be displayed as "You" on our side but as Peer1, Peer2, etc. on the peer's side
    timestamp: Date.now(),
    isHost: isSessionHost() // Include our host status in the handshake
  }));
  
  console.log(`Sent handshake to peer ${remotePublicKey.slice(0, 8)}... with host status: ${isSessionHost()}`);
  
  conn.on('close', () => {
    console.log('Peer disconnected:', remotePublicKey);
    
    // Add to chat history and update display
    addToChatHistory({
      type: 'system',
      content: `Peer disconnected: ${remotePublicKey.slice(0, 8)}...`
    });
    
    // Remove from connections list
    const index = conns.indexOf(conn);
    if (index > -1) conns.splice(index, 1);
    
    // Remove from active peers
    removePeer(remotePublicKey);
  });
  
  conn.on('error', (err) => {
    console.error('Connection error:', err);
  });
}

/**
 * Initialize a new chat session with our own topic
 * @param {Object} options - Local presentation options
 * @param {boolean} options.announce - Log and add the legacy system message
 * @param {boolean} options.notify - Dispatch the local topic state event
 */
function initializeNewChat({ announce = true, notify = announce } = {}) {
  leaveExistingChat({ announce: false });

  try {
    const nextTopic = crypto.randomBytes(32);
    const nextTopicHex = b4a.toString(nextTopic, 'hex');
    topic = nextTopic;
    topicHex = nextTopicHex;
    setSessionHost(true);

    const nextDiscovery = swarm.join(nextTopic, { server: true, client: true });
    if (!nextDiscovery) throw new Error('Hyperswarm did not create a discovery handle.');

    discovery = nextDiscovery;

    if (notify) document.dispatchEvent(new Event('swarmTopicChanged'));
    if (announce) {
      console.log('Starting new chat session with topic:', topicHex);
      addToChatHistory({
        type: 'system',
        content: `Connected to Hyperswarm. Waiting for peers...\n\nP2P Topic: ${topicHex}\n\nShare this topic with others to let them join your chat session.`
      });
    }
    return true;
  } catch (error) {
    clearLifecycleState();
    console.error('Error starting chat:', error);
    if (notify) document.dispatchEvent(new Event('swarmTopicChanged'));
    if (announce) {
      addToChatHistory({ type: 'system', content: `Error starting chat: ${error.message}` });
    }
    return false;
  }
}

/**
 * Join an existing chat with provided topic
 * @param {string} topicKeyHex - The hex representation of the topic key
 * @param {Object} options - Local presentation options
 * @param {boolean} options.announce - Log and add legacy system messages
 * @param {boolean} options.notify - Dispatch the local topic state event
 * @returns {boolean} True if joining was successful
 */
function joinExistingChat(topicKeyHex, { announce = true, notify = announce } = {}) {
  if (!topicKeyHex || topicKeyHex.length !== 64 || !/^[0-9a-f]+$/i.test(topicKeyHex)) {
    const error = new Error('Invalid topic key format. It should be a 64-character hexadecimal string.');
    console.error('Error joining chat:', error);
    if (announce) {
      addToChatHistory({ type: 'system', content: `Error joining chat: ${error.message}` });
    }
    return false;
  }

  try {
    // Deterministically tear down the prior room before attempting the new one.
    leaveExistingChat({ announce: false });

    const nextTopic = b4a.from(topicKeyHex, 'hex');
    topic = nextTopic;
    topicHex = topicKeyHex;
    setSessionHost(false);

    const nextDiscovery = swarm.join(nextTopic, { server: true, client: true });
    if (!nextDiscovery) throw new Error('Hyperswarm did not create a discovery handle.');

    discovery = nextDiscovery;

    if (notify) document.dispatchEvent(new Event('swarmTopicChanged'));
    if (announce) {
      console.log('Joining existing chat session with topic:', topicHex);
      addToChatHistory({
        type: 'system',
        content: `Joining existing chat session with topic: ${topicHex}\n\nWaiting for peers...`
      });
    }
    
    return true;
  } catch (error) {
    clearLifecycleState();
    console.error('Error joining chat:', error);
    if (notify) document.dispatchEvent(new Event('swarmTopicChanged'));
    if (announce) {
      addToChatHistory({
        type: 'system',
        content: `Error joining chat: ${error.message}`
      });
    }
    return false;
  }
}

function clearLifecycleState() {
  const previousTopic = topic;
  const previousDiscovery = discovery;
  const previousConnections = conns;

  topic = null;
  topicHex = null;
  discovery = null;
  conns = [];
  setSessionHost(false);
  resetPeers();

  if (previousDiscovery && typeof previousDiscovery.destroy === 'function') {
    try {
      const destroying = previousDiscovery.destroy();
      if (destroying && typeof destroying.catch === 'function') {
        destroying.catch((err) => console.warn('Error destroying discovery:', err));
      }
    } catch (err) {
      console.warn('Error destroying discovery:', err);
    }
  } else if (previousTopic && swarm) {
    try {
      swarm.leave(previousTopic);
    } catch (err) {
      console.warn('Error leaving topic:', err);
    }
  }

  for (const conn of previousConnections) {
    try {
      conn.destroy();
    } catch (err) {
      console.warn('Error destroying connection:', err);
    }
  }
}

/**
 * Leave the current chat
 * @param {Object} options - Local presentation options
 * @param {boolean} options.announce - Retained presentation default for compatibility
 * @param {boolean} options.notify - Dispatch the local topic state event
 */
function leaveExistingChat({ announce = true, notify = announce } = {}) {
  clearLifecycleState();
  if (notify) document.dispatchEvent(new Event('swarmTopicChanged'));
}

/**
 * Get the current topic hex
 * @returns {string|null} The current topic hex or null if not set
 */
function getTopicHex() {
  return topicHex || null;
}

/**
 * Check whether the local Hyperswarm instance has been initialized.
 * @returns {boolean} True after initializeSwarm has run
 */
function isSwarmInitialized() {
  return Boolean(swarm);
}

/**
 * Get all current connections
 * @returns {Array} The array of connections
 */
function getConnections() {
  return conns;
}

/**
 * Get our public key
 * @returns {string} Our public key as a hex string
 */
function getPublicKey() {
  return b4a.toString(swarm.keyPair.publicKey, 'hex');
}

/**
 * Return a narrow, local-only snapshot for DHT diagnostics. A non-boolean
 * `swarm.listening` value (including Hyperswarm's in-flight Promise) is not a
 * reliable listening result, so it is reported as unknown.
 */
function getDHTDiagnostics() {
  const initialized = Boolean(swarm);
  let publicKey = null;

  if (initialized && swarm.keyPair?.publicKey) {
    try {
      const candidate = b4a.toString(swarm.keyPair.publicKey, 'hex');
      if (/^[0-9a-f]{64}$/i.test(candidate)) publicKey = candidate.toLowerCase();
    } catch (_error) {
      publicKey = null;
    }
  }

  return {
    initialized,
    publicKey,
    topic: initialized ? (topicHex || null) : null,
    connectionCount: initialized ? conns.length : 0,
    listening: initialized && typeof swarm.listening === 'boolean'
      ? swarm.listening
      : null
  };
}

/**
 * Check if we're connected to any peers
 * @returns {boolean} True if connected to any peers
 */
function isConnectedToPeers() {
  return conns.length > 0;
}

/**
 * Find the host connection among all connections
 * @returns {Object|null} The host connection or null if not found
 */
function findHostConnection() {
  for (const conn of conns) {
    const peerId = b4a.toString(conn.remotePublicKey, 'hex');
    const peerInfo = getPeerInfo(peerId);
    if (peerInfo?.isHost || peerInfo?.isServer) {
      return conn;
    }
  }

  // Before handshake metadata arrives, fall back to the first connection so early
  // model requests do not dead-end. Once handshakes complete, explicit host flags win.
  return conns[0] || null;
}

// Export functions
export {
  initializeSwarm,
  initializeNewChat,
  joinExistingChat,
  leaveExistingChat,
  isSwarmInitialized,
  getTopicHex,
  getConnections,
  getPublicKey,
  getDHTDiagnostics,
  isConnectedToPeers,
  findHostConnection,
  // Also export the swarm for direct access if needed
  swarm,
  conns
};
