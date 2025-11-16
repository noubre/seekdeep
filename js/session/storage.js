/**
 * Session Storage Module
 * Manages saving, loading, and managing chat sessions in localStorage
 */

const STORAGE_PREFIX = 'seekdeep-';
const REGISTRY_KEY = `${STORAGE_PREFIX}sessions-registry`;
const SESSION_KEY_PREFIX = `${STORAGE_PREFIX}session-`;

/**
 * Get the sessions registry from localStorage
 * @returns {Array} Array of session metadata objects
 */
export function getSessionsRegistry() {
  try {
    const registryJson = localStorage.getItem(REGISTRY_KEY);
    if (!registryJson) {
      return [];
    }
    return JSON.parse(registryJson);
  } catch (error) {
    console.error('[Storage] Failed to load sessions registry:', error);
    return [];
  }
}

/**
 * Save the sessions registry to localStorage
 * @param {Array} registry - Array of session metadata objects
 * @returns {boolean} Success status
 */
function saveSessionsRegistry(registry) {
  try {
    localStorage.setItem(REGISTRY_KEY, JSON.stringify(registry));
    return true;
  } catch (error) {
    console.error('[Storage] Failed to save sessions registry:', error);
    if (error.name === 'QuotaExceededError') {
      alert('Storage quota exceeded. Please delete some old sessions to save new ones.');
    }
    return false;
  }
}

/**
 * Generate a unique session ID
 * @returns {string} Unique session ID
 */
function generateSessionId() {
  return `session-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Generate a session name based on timestamp
 * @param {number} timestamp - Unix timestamp
 * @returns {string} Human-readable session name
 */
function generateSessionName(timestamp) {
  const date = new Date(timestamp);
  const options = { 
    month: 'short', 
    day: 'numeric', 
    hour: 'numeric', 
    minute: '2-digit',
    hour12: true 
  };
  return `Chat - ${date.toLocaleDateString('en-US', options)}`;
}

/**
 * Extract preview text from session messages
 * @param {Array} messages - Array of message objects
 * @returns {string} Preview text
 */
function extractPreview(messages) {
  // Find first user message
  const firstUserMessage = messages.find(msg => msg.type === 'user');
  if (!firstUserMessage) {
    return 'No messages';
  }
  
  // Truncate to 50 characters
  const content = firstUserMessage.content || '';
  return content.length > 50 ? content.substring(0, 50) + '...' : content;
}

/**
 * Save a session to localStorage
 * @param {Object} sessionData - The session data to save
 * @param {string} customName - Optional custom name for the session
 * @returns {Object|null} Saved session metadata or null on failure
 */
export function saveSession(sessionData, customName = null) {
  try {
    const sessionId = generateSessionId();
    const timestamp = Date.now();
    const name = customName || generateSessionName(timestamp);
    
    // Create session metadata
    const metadata = {
      id: sessionId,
      name: name,
      timestamp: timestamp,
      messageCount: sessionData.messages?.length || 0,
      preview: extractPreview(sessionData.messages || []),
      model: sessionData.model || 'unknown',
      provider: sessionData.provider || 'unknown'
    };
    
    // Save session data
    const sessionKey = `${SESSION_KEY_PREFIX}${sessionId}`;
    const fullSessionData = {
      ...sessionData,
      sessionId: sessionId,
      name: name,
      savedAt: new Date().toISOString(),
      savedTimestamp: timestamp
    };
    
    localStorage.setItem(sessionKey, JSON.stringify(fullSessionData));
    
    // Update registry
    const registry = getSessionsRegistry();
    registry.unshift(metadata); // Add to beginning of array
    
    if (!saveSessionsRegistry(registry)) {
      // If registry save fails, remove the session data
      localStorage.removeItem(sessionKey);
      return null;
    }
    
    console.log(`[Storage] Session saved: ${sessionId} (${name})`);
    return metadata;
  } catch (error) {
    console.error('[Storage] Failed to save session:', error);
    if (error.name === 'QuotaExceededError') {
      alert('Storage quota exceeded. Please delete some old sessions to save new ones.');
    }
    return null;
  }
}

/**
 * Load a session from localStorage
 * @param {string} sessionId - The session ID to load
 * @returns {Object|null} Session data or null if not found
 */
export function loadSession(sessionId) {
  try {
    const sessionKey = `${SESSION_KEY_PREFIX}${sessionId}`;
    const sessionJson = localStorage.getItem(sessionKey);
    
    if (!sessionJson) {
      console.warn(`[Storage] Session not found: ${sessionId}`);
      return null;
    }
    
    const sessionData = JSON.parse(sessionJson);
    console.log(`[Storage] Session loaded: ${sessionId}`);
    return sessionData;
  } catch (error) {
    console.error('[Storage] Failed to load session:', error);
    return null;
  }
}

/**
 * Delete a session from localStorage
 * @param {string} sessionId - The session ID to delete
 * @returns {boolean} Success status
 */
export function deleteSession(sessionId) {
  try {
    // Remove session data
    const sessionKey = `${SESSION_KEY_PREFIX}${sessionId}`;
    localStorage.removeItem(sessionKey);
    
    // Update registry
    const registry = getSessionsRegistry();
    const filteredRegistry = registry.filter(session => session.id !== sessionId);
    saveSessionsRegistry(filteredRegistry);
    
    console.log(`[Storage] Session deleted: ${sessionId}`);
    return true;
  } catch (error) {
    console.error('[Storage] Failed to delete session:', error);
    return false;
  }
}

/**
 * List all saved sessions
 * @returns {Array} Array of session metadata objects
 */
export function listSessions() {
  const registry = getSessionsRegistry();
  // Sort by timestamp, newest first
  return registry.sort((a, b) => b.timestamp - a.timestamp);
}

/**
 * Get metadata for a specific session
 * @param {string} sessionId - The session ID
 * @returns {Object|null} Session metadata or null if not found
 */
export function getSessionMetadata(sessionId) {
  const registry = getSessionsRegistry();
  return registry.find(session => session.id === sessionId) || null;
}

/**
 * Import a session from a JSON file object
 * @param {Object} sessionData - The parsed session data from JSON
 * @param {string} customName - Optional custom name
 * @returns {Object|null} Saved session metadata or null on failure
 */
export function importSessionFromData(sessionData, customName = null) {
  // Validate session data
  if (!sessionData || !sessionData.messages || !Array.isArray(sessionData.messages)) {
    console.error('[Storage] Invalid session data for import');
    return null;
  }
  
  return saveSession(sessionData, customName);
}

/**
 * Search sessions by content
 * @param {string} query - Search query
 * @returns {Array} Array of matching session metadata
 */
export function searchSessions(query) {
  if (!query || query.trim() === '') {
    return listSessions();
  }
  
  const registry = getSessionsRegistry();
  const lowerQuery = query.toLowerCase();
  
  // Search in name and preview
  return registry.filter(session => {
    return session.name.toLowerCase().includes(lowerQuery) ||
           session.preview.toLowerCase().includes(lowerQuery);
  }).sort((a, b) => b.timestamp - a.timestamp);
}

/**
 * Get storage usage information
 * @returns {Object} Storage statistics
 */
export function getStorageStats() {
  try {
    const registry = getSessionsRegistry();
    let totalSize = 0;
    
    // Calculate size of all sessions
    for (const session of registry) {
      const sessionKey = `${SESSION_KEY_PREFIX}${session.id}`;
      const sessionData = localStorage.getItem(sessionKey);
      if (sessionData) {
        totalSize += sessionData.length;
      }
    }
    
    // Add registry size
    const registryData = localStorage.getItem(REGISTRY_KEY);
    if (registryData) {
      totalSize += registryData.length;
    }
    
    return {
      sessionCount: registry.length,
      totalSize: totalSize,
      totalSizeKB: (totalSize / 1024).toFixed(2),
      totalSizeMB: (totalSize / (1024 * 1024)).toFixed(2)
    };
  } catch (error) {
    console.error('[Storage] Failed to calculate storage stats:', error);
    return {
      sessionCount: 0,
      totalSize: 0,
      totalSizeKB: '0',
      totalSizeMB: '0'
    };
  }
}

/**
 * Clear all saved sessions (use with caution!)
 * @returns {boolean} Success status
 */
export function clearAllSessions() {
  try {
    const registry = getSessionsRegistry();
    
    // Remove all session data
    for (const session of registry) {
      const sessionKey = `${SESSION_KEY_PREFIX}${session.id}`;
      localStorage.removeItem(sessionKey);
    }
    
    // Clear registry
    localStorage.removeItem(REGISTRY_KEY);
    
    console.log('[Storage] All sessions cleared');
    return true;
  } catch (error) {
    console.error('[Storage] Failed to clear sessions:', error);
    return false;
  }
}

export default {
  saveSession,
  loadSession,
  deleteSession,
  listSessions,
  getSessionMetadata,
  importSessionFromData,
  searchSessions,
  getStorageStats,
  clearAllSessions
};