/**
 * Network Hyperswarm module
 * Contains functions for managing the Hyperswarm P2P network
 */
import Hyperswarm from 'hyperswarm';
import crypto from 'hypercore-crypto';
import b4a from 'b4a';
import { addToChatHistory } from '../messages/history.js';
import { updateActivePeer, removePeer, resetPeers } from '../session/peers.js';
import { setSessionHost, isSessionHost } from '../session/modes.js';
import { setupPeerMessageHandler } from './messaging.js';

// Initialize Hyperswarm
let swarm;
let topic; // Will store current topic
let topicHex; // Will store hex representation of topic
let conns = []; // Store connections
let keyPair; // Store our key pair

/**
 * Initialize the Hyperswarm network
 */
function initializeSwarm() {
  swarm = new Hyperswarm();
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
  conns.push(conn);
  
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
 */
function initializeNewChat() {
  // Generate a new random topic
  topic = crypto.randomBytes(32);
  topicHex = b4a.toString(topic, 'hex');
  
  // Clear existing connections
  leaveExistingChat();
  
  // Set as session host
  setSessionHost(true);
  
  // Log connection status
  console.log('Starting new chat session with topic:', topicHex);
  
  // Add initial system message
  addToChatHistory({
    type: 'system',
    content: `Connected to Hyperswarm. Waiting for peers...\n\nP2P Topic: ${topicHex}\n\nShare this topic with others to let them join your chat session.`
  });
  
  // Join swarm with our topic
  swarm.join(topic, { server: true, client: true });
}

/**
 * Join an existing chat with provided topic
 * @param {string} topicKeyHex - The hex representation of the topic key
 * @returns {boolean} True if joining was successful
 */
function joinExistingChat(topicKeyHex) {
  try {
    // Validate the topic key format
    if (!topicKeyHex || topicKeyHex.length !== 64 || !/^[0-9a-f]+$/i.test(topicKeyHex)) {
      throw new Error('Invalid topic key format. It should be a 64-character hexadecimal string.');
    }
    
    // Convert hex string to Buffer
    topic = b4a.from(topicKeyHex, 'hex');
    topicHex = topicKeyHex;
    
    // Clear existing connections
    leaveExistingChat();
    
    // Set as joiner (not host)
    setSessionHost(false);
    
    // Log connection status
    console.log('Joining existing chat session with topic:', topicHex);
    
    // Add initial system message
    addToChatHistory({
      type: 'system',
      content: `Joining existing chat session with topic: ${topicHex}\n\nWaiting for peers...`
    });
    
    // Join the swarm with the provided topic
    swarm.join(topic, { server: true, client: true });
    
    return true;
  } catch (error) {
    console.error('Error joining chat:', error);
    addToChatHistory({
      type: 'system',
      content: `Error joining chat: ${error.message}`
    });
    return false;
  }
}

/**
 * Leave the current chat
 */
function leaveExistingChat() {
  // Leave the current topic if it exists
  if (topic) {
    try {
      swarm.leave(topic);
    } catch (err) {
      console.warn('Error leaving topic:', err);
    }
  }
  
  // Disconnect all existing connections
  for (const conn of conns) {
    try {
      conn.destroy();
    } catch (err) {
      console.warn('Error destroying connection:', err);
    }
  }
  
  // Clear connections array
  conns = [];
  
  // Clear active peers
  resetPeers();
  
  // Reset host status (will be set again when creating/joining a new chat)
  setSessionHost(false);
}

/**
 * Get the current topic hex
 * @returns {string|null} The current topic hex or null if not set
 */
function getTopicHex() {
  return topicHex || null;
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
 * Check if we're connected to any peers
 * @returns {boolean} True if connected to any peers
 */
function isConnectedToPeers() {
  return conns.length > 0;
}

// Export functions
export {
  initializeSwarm,
  initializeNewChat,
  joinExistingChat,
  leaveExistingChat,
  getTopicHex,
  getConnections,
  getPublicKey,
  isConnectedToPeers,
  // Also export the swarm for direct access if needed
  swarm,
  conns
};
