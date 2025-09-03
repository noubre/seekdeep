/**
 * Session Modes module
 * Contains functions for managing session host/peer roles
 * Note: Collaborative mode has been removed - all sessions are now private mode only
 */

// Track whether user is a host (created session) or joiner (joined via swarm key)
let sessionHost = false;

/**
 * Initialize the chat mode (always private mode now)
 */
function initializeChatMode() {
  sessionHost = false;
}

/**
 * Get the current chat mode (always private mode now)
 * @returns {boolean} Always returns false (private mode)
 */
function getCollaborativeMode() {
  return false; // Always private mode
}

/**
 * Set whether the user is a session host
 * @param {boolean} isHost - Whether the user is a session host
 */
function setSessionHost(isHost) {
  sessionHost = isHost;
}

/**
 * Check if the user is a session host
 * @returns {boolean} True if the user is a session host
 */
function isSessionHost() {
  return sessionHost;
}

// Export functions
export {
  initializeChatMode,
  getCollaborativeMode,
  setSessionHost,
  isSessionHost
};
