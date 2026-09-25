/**
 * Session Modes module
 * Contains functions for managing session host/peer roles and chat visibility mode
 */

// Track whether user is a host (created session) or joiner (joined via swarm key)
let sessionHost = false;

// Track whether room messages/responses should be shared with all peers.
// Private mode keeps each peer's request/response visible only to that peer and the host.
let collaborativeMode = false;

/**
 * Initialize the chat mode.
 */
function initializeChatMode() {
  sessionHost = false;
  collaborativeMode = false;
}

/**
 * Get the current chat mode.
 * @returns {boolean} True for collaborative mode, false for private mode
 */
function getCollaborativeMode() {
  return collaborativeMode;
}

/**
 * Set the current chat mode.
 * @param {boolean} isCollaborative - True for collaborative mode, false for private mode
 */
function setCollaborativeMode(isCollaborative) {
  collaborativeMode = Boolean(isCollaborative);

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('chatModeChanged', {
      detail: { isCollaborativeMode: collaborativeMode }
    }));
  }
}

/**
 * Set whether the user is a session host
 * @param {boolean} isHost - Whether the user is a session host
 */
function setSessionHost(isHost) {
  sessionHost = Boolean(isHost);
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
  setCollaborativeMode,
  setSessionHost,
  isSessionHost
};
