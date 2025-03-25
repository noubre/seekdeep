/**
 * Session Modes module
 * Contains functions for managing chat modes (collaborative vs. private)
 */
import { addToChatHistory } from '../messages/history.js';
import { setChatModeSelectValue, setChatModeSelectEnabled } from '../ui/elements.js';
import { broadcastToPeers } from '../network/messaging.js';

// Track whether we're in collaborative mode (shared chat) or private mode (separate chats)
let isCollaborativeMode = false;

// Track whether user is a host (created session) or joiner (joined via swarm key)
let sessionHost = false;

/**
 * Initialize the chat mode
 */
function initializeChatMode() {
  // Default to private mode
  isCollaborativeMode = false;
  sessionHost = false;
}

/**
 * Set the chat mode
 * @param {boolean} collaborative - Whether to set collaborative mode (true) or private mode (false)
 */
function setChatMode(collaborative) {
  if (collaborative !== isCollaborativeMode) {
    // Store the old mode for logging
    const oldMode = isCollaborativeMode;
    
    // Update to the new mode
    isCollaborativeMode = collaborative;
    
    console.log(`Setting chat mode to ${isCollaborativeMode ? 'Collaborative' : 'Private'}, sessionHost: ${sessionHost}`);
    
    addToChatHistory({
      type: 'system',
      content: `Chat mode set to ${isCollaborativeMode ? 'Collaborative (shared chat)' : 'Private (separate chats)'}.`
    });
    
    // Update the UI to reflect the current mode
    setChatModeSelectValue(isCollaborativeMode);
    
    // If we're the host, notify all connected peers about the mode change
    if (sessionHost) {
      console.log(`Broadcasting mode update to peers: ${isCollaborativeMode ? 'Collaborative' : 'Private'}`);
      
      // Create the mode update message
      const modeUpdateMessage = {
        type: 'mode_update',
        isCollaborativeMode: isCollaborativeMode,
        previousMode: oldMode
      };
      
      // We need to temporarily force broadcast to all peers regardless of current mode
      // This ensures the mode update is sent even when switching to private mode
      const sentCount = broadcastToPeers(modeUpdateMessage, null, null, true);
      console.log(`Mode update sent to ${sentCount} peers`);
    }
  }
}

/**
 * Get the current chat mode
 * @returns {boolean} True if in collaborative mode, false if in private mode
 */
function getCollaborativeMode() {
  return isCollaborativeMode;
}

/**
 * Set whether the user is a session host
 * @param {boolean} isHost - Whether the user is a session host
 */
function setSessionHost(isHost) {
  sessionHost = isHost;
  
  // Only the host can change the chat mode
  setChatModeSelectEnabled(isHost);
}

/**
 * Check if the user is a session host
 * @returns {boolean} True if the user is a session host
 */
function isSessionHost() {
  return sessionHost;
}

/**
 * Handle a mode update message from a peer
 * @param {Object} message - The mode update message
 * @param {string} peerId - The ID of the peer who sent the message
 * @param {boolean} isPeerHost - Whether the peer is a host
 */
function handleModeUpdateMessage(message, peerId, isPeerHost) {
  console.log(`Received mode update from peer ${peerId.slice(0, 8)}... Mode: ${message.isCollaborativeMode ? 'Collaborative' : 'Private'}`);
  console.log(`Mode update details: isPeerHost=${isPeerHost}, sessionHost=${sessionHost}, current mode=${isCollaborativeMode}, messageIsHost=${message.isHost}`);
  
  // Check if the message has the isHost flag and use it if available
  const senderIsHost = message.isHost === true || isPeerHost;
  
  // If we're a joiner, ONLY update our local mode setting if the message comes from the host
  if (!sessionHost && senderIsHost) {
    console.log(`Accepting mode update from host: ${message.isCollaborativeMode ? 'Collaborative' : 'Private'}`);
    isCollaborativeMode = message.isCollaborativeMode;
    
    // Update the UI to reflect the host's setting
    setChatModeSelectValue(isCollaborativeMode);
    
    // Ensure the dropdown remains disabled for peers
    setChatModeSelectEnabled(false);
    
    addToChatHistory({
      type: 'system',
      content: `Chat mode set to ${isCollaborativeMode ? 'Collaborative (shared chat)' : 'Private (separate chats)'}.`
    });
  } else if (!sessionHost) {
    // Log that we're ignoring a mode update from a non-host peer
    console.log(`Ignoring mode update from non-host peer: ${peerId.slice(0, 8)}..., isHost=${message.isHost}, isPeerHost=${isPeerHost}`);
  } else {
    console.log(`Not processing mode update because we are the host (sessionHost=${sessionHost})`);
  }
}

// Export functions
export {
  initializeChatMode,
  setChatMode,
  getCollaborativeMode,
  setSessionHost,
  isSessionHost,
  handleModeUpdateMessage,
  // Also export the state variables for direct access if needed
  isCollaborativeMode
};
