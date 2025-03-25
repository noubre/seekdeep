/**
 * Session Peers module
 * Contains functions for managing peers in the session
 */
import { updateActiveUsersDisplay } from '../ui/rendering.js';

// Peer colors - used for visual distinction between different peers
export const PEER_COLORS = [
  { class: 'peer-color-1', name: 'Blue' },
  { class: 'peer-color-2', name: 'Teal' },
  { class: 'peer-color-3', name: 'Purple' },
  { class: 'peer-color-4', name: 'Red' },
  { class: 'peer-color-5', name: 'Green' }
];

// Track users/peers in the chat
const activePeers = new Map(); // Maps peer IDs to their info (name, color, etc.)
let nextPeerColorIndex = 0;

/**
 * Get the next peer color in rotation
 * @returns {Object} The next peer color object
 */
function getNextPeerColor() {
  const color = PEER_COLORS[nextPeerColorIndex];
  nextPeerColorIndex = (nextPeerColorIndex + 1) % PEER_COLORS.length;
  return color;
}

/**
 * Add or update a peer in the active peers list
 * @param {string} peerId - The ID of the peer
 * @param {Object} peerInfo - Information about the peer
 */
function updateActivePeer(peerId, peerInfo) {
  // If peer already exists, update their info
  if (activePeers.has(peerId)) {
    const existingInfo = activePeers.get(peerId);
    activePeers.set(peerId, { ...existingInfo, ...peerInfo });
  } else {
    // If new peer, assign a color and add them
    const color = getNextPeerColor();
    // Find the next available peer number
    let peerNumber = activePeers.size + 1; // Start from Peer1
    // Ensure we're not reusing numbers
    const usedNumbers = new Set();
    activePeers.forEach(p => {
      if (p.peerNumber) usedNumbers.add(p.peerNumber);
    });
    while (usedNumbers.has(peerNumber)) {
      peerNumber++;
    }
    
    activePeers.set(peerId, { 
      id: peerId,
      displayName: peerInfo.displayName || `Peer${peerNumber}`,
      peerNumber: peerNumber,
      colorClass: color.class,
      colorName: color.name,
      ...peerInfo 
    });
  }
  
  // Update the active users display
  updateActiveUsersDisplay();
}

/**
 * Remove a peer from the active list
 * @param {string} peerId - The ID of the peer to remove
 */
function removePeer(peerId) {
  activePeers.delete(peerId);
  updateActiveUsersDisplay();
}

/**
 * Get all active peers
 * @returns {Map} The map of active peers
 */
function getActivePeers() {
  return activePeers;
}

/**
 * Get information about a specific peer
 * @param {string} peerId - The ID of the peer
 * @returns {Object|null} The peer information or null if not found
 */
function getPeerInfo(peerId) {
  return activePeers.get(peerId) || null;
}

/**
 * Check if a peer is the host
 * @param {string} peerId - The ID of the peer
 * @param {Array} connections - The array of connections
 * @returns {boolean} True if the peer is the host
 */
function isPeerHost(peerId, connections) {
  const peerInfo = activePeers.get(peerId);
  
  // Log for debugging
  console.log(`Checking if peer ${peerId.slice(0, 8)}... is host:`, {
    isServer: peerInfo?.isServer,
    firstConnection: connections.length > 0 && connections[0] && 
                    connections[0].remotePublicKey === peerId,
    peerInfo: peerInfo
  });
  
  return peerInfo && (
    peerInfo.isServer || 
    peerInfo.isHost || // Add explicit host flag check
    // For our implementation, the first peer we connect to is considered the host
    (connections.length > 0 && connections[0] && 
     connections[0].remotePublicKey === peerId)
  );
}

/**
 * Reset the peer tracking state
 */
function resetPeers() {
  activePeers.clear();
  nextPeerColorIndex = 0;
  updateActiveUsersDisplay();
}

/**
 * Get the display name for a peer
 * @param {string} peerId - The ID of the peer
 * @returns {string} The display name for the peer
 */
function getPeerDisplayName(peerId) {
  const peerInfo = activePeers.get(peerId);
  return peerInfo ? peerInfo.displayName : `Peer${peerId.slice(0, 6)}`;
}

// Export functions
export {
  getNextPeerColor,
  updateActivePeer,
  removePeer,
  getActivePeers,
  getPeerInfo,
  isPeerHost,
  resetPeers,
  getPeerDisplayName
};
