/**
 * Persistence Manager
 * Manages chat persistence integration with the history module
 */
import { ChatPersistence } from './persistence.js';
import { getChatHistory, addToChatHistory } from './history.js';
import { saveSession, importSessionFromData } from '../session/storage.js';
import { getSelectedModel, getSelectedProvider } from '../ui/elements.js';

// Persistence instance
let persistence = null;

// Persistence enabled flag
let persistenceEnabled = true;

/**
 * Initialize persistence for a session
 * @param {string} sessionTopic - The session topic identifier
 * @param {Object} options - Persistence options
 * @returns {Promise<boolean>} Success status
 */
export async function initializePersistence(sessionTopic, options = {}) {
  // Hyperbee/Hypercore persistence disabled - incompatible with Pear browser environment
  // Hypercore requires file system access (even for RAM storage) which isn't available
  // Export/import functionality remains fully operational for manual persistence
  console.log('[PersistenceManager] Hyperbee disabled - incompatible with Pear browser environment');
  console.log('[PersistenceManager] Use Export button to save chats as JSON');
  return false;
}

/**
 * Save a message to persistence
 * @param {Object} message - The message to save
 * @returns {Promise<boolean>} Success status
 */
export async function saveMessage(message) {
  if (!persistence || !persistence.isReady()) {
    return false;
  }

  try {
    return await persistence.saveMessage(message);
  } catch (error) {
    console.error('[PersistenceManager] Failed to save message:', error);
    return false;
  }
}

/**
 * Load persisted messages from storage
 * @param {Object} options - Load options
 * @returns {Promise<Array>} Loaded messages
 */
export async function loadPersistedMessages(options = {}) {
  if (!persistence || !persistence.isReady()) {
    console.log('[PersistenceManager] Not ready, cannot load messages');
    return [];
  }

  try {
    const messages = await persistence.loadMessages(options);
    
    if (messages.length > 0) {
      console.log(`[PersistenceManager] Loaded ${messages.length} messages`);
      
      // Display system message about loaded history
      await addToChatHistory({
        type: 'system',
        content: `📜 Loaded ${messages.length} messages from previous session`,
        timestamp: Date.now(),
        skipPersist: true // Don't re-persist this system message
      });
    }
    
    return messages;
  } catch (error) {
    console.error('[PersistenceManager] Failed to load messages:', error);
    return [];
  }
}

/**
 * Clear persisted messages from storage
 * @returns {Promise<boolean>} Success status
 */
export async function clearPersistedMessages() {
  if (!persistence || !persistence.isReady()) {
    return false;
  }

  try {
    const success = await persistence.clear();
    if (success) {
      console.log('[PersistenceManager] Cleared all persisted messages');
      
      // Add system message
      await addToChatHistory({
        type: 'system',
        content: '🗑️ Chat history cleared',
        timestamp: Date.now(),
        skipPersist: true
      });
    }
    return success;
  } catch (error) {
    console.error('[PersistenceManager] Failed to clear messages:', error);
    return false;
  }
}

/**
 * Export current session to JSON and save to localStorage
 * @returns {Promise<Object|null>} Exported session data
 */
export async function exportSession() {
  try {
    // Get current chat history from memory
    const history = getChatHistory();
    
    // Get current model and provider
    const model = getSelectedModel();
    const provider = getSelectedProvider();
    
    // Create session data
    const sessionData = {
      exportedAt: new Date().toISOString(),
      exportedTimestamp: Date.now(),
      messageCount: history.length,
      messages: history,
      model: model,
      provider: provider
    };
    
    // Save to localStorage
    const savedMetadata = saveSession(sessionData);
    
    if (savedMetadata) {
      console.log('[PersistenceManager] Session saved to localStorage:', savedMetadata.id);
    }
    
    return sessionData;
  } catch (error) {
    console.error('[PersistenceManager] Failed to export session:', error);
    return null;
  }
}

/**
 * Download exported session as JSON file and save to localStorage
 * @returns {Promise<boolean>} Success status
 */
export async function downloadSessionExport() {
  try {
    const sessionData = await exportSession();
    if (!sessionData) {
      return false;
    }

    // Create blob and download
    const blob = new Blob([JSON.stringify(sessionData, null, 2)], {
      type: 'application/json'
    });
    
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `seekdeep-session-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    console.log('[PersistenceManager] Session downloaded and saved to history');
    
    // Add system message
    await addToChatHistory({
      type: 'system',
      content: '💾 Session exported and saved to history',
      timestamp: Date.now(),
      skipPersist: true
    });
    
    return true;
  } catch (error) {
    console.error('[PersistenceManager] Failed to download export:', error);
    return false;
  }
}

/**
 * Search messages in persistence
 * @param {string} searchTerm - Term to search for
 * @param {Object} options - Search options
 * @returns {Promise<Array>} Matching messages
 */
export async function searchMessages(searchTerm, options = {}) {
  if (!persistence || !persistence.isReady()) {
    // Fallback to in-memory search
    const term = searchTerm.toLowerCase();
    const history = getChatHistory();
    return history.filter(msg => 
      msg.content?.toLowerCase().includes(term) ||
      msg.fromPeer?.toLowerCase().includes(term)
    );
  }

  try {
    return await persistence.searchMessages(searchTerm, options);
  } catch (error) {
    console.error('[PersistenceManager] Failed to search messages:', error);
    return [];
  }
}

/**
 * Get persistence statistics
 * @returns {Promise<Object>} Statistics object
 */
export async function getPersistenceStats() {
  if (!persistence) {
    return {
      enabled: false,
      ready: false,
      messageCount: 0
    };
  }

  try {
    return await persistence.getStats();
  } catch (error) {
    console.error('[PersistenceManager] Failed to get stats:', error);
    return {
      enabled: false,
      ready: false,
      messageCount: 0,
      error: error.message
    };
  }
}

/**
 * Enable or disable persistence
 * @param {boolean} enabled - Whether to enable persistence
 */
export function setPersistenceEnabled(enabled) {
  persistenceEnabled = enabled;
  console.log(`[PersistenceManager] Persistence ${enabled ? 'enabled' : 'disabled'}`);
  
  // Save preference to localStorage
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem('seekdeep-persistence-enabled', enabled.toString());
  }
}

/**
 * Check if persistence is enabled
 * @returns {boolean} Whether persistence is enabled
 */
export function isPersistenceEnabled() {
  return persistenceEnabled && persistence && persistence.isReady();
}

/**
 * Get the persistence instance
 * @returns {ChatPersistence|null} The persistence instance
 */
export function getPersistenceInstance() {
  return persistence;
}

/**
 * Close persistence and release resources
 * @returns {Promise<void>}
 */
export async function closePersistence() {
  if (persistence) {
    try {
      await persistence.close();
      persistence = null;
      console.log('[PersistenceManager] Closed');
    } catch (error) {
      console.error('[PersistenceManager] Failed to close:', error);
    }
  }
}

/**
 * Load persistence preference from localStorage
 */
export function loadPersistencePreference() {
  if (typeof localStorage !== 'undefined') {
    const saved = localStorage.getItem('seekdeep-persistence-enabled');
    if (saved !== null) {
      persistenceEnabled = saved === 'true';
      console.log(`[PersistenceManager] Loaded preference: ${persistenceEnabled}`);
    }
  }
}

/**
 * Import a session from a JSON file
 * @param {File} file - The JSON file to import
 * @returns {Promise<boolean>} Success status
 */
export async function importSessionFromFile(file) {
  try {
    // Read file content
    const fileContent = await file.text();
    const sessionData = JSON.parse(fileContent);
    
    // Validate session data
    if (!sessionData.messages || !Array.isArray(sessionData.messages)) {
      throw new Error('Invalid session file format');
    }
    
    // Import to localStorage
    const metadata = importSessionFromData(sessionData);
    
    if (!metadata) {
      throw new Error('Failed to save session to storage');
    }
    
    console.log('[PersistenceManager] Session imported:', metadata.id);
    
    // Add system message
    await addToChatHistory({
      type: 'system',
      content: `📥 Session imported: ${metadata.name} (${metadata.messageCount} messages)`,
      timestamp: Date.now(),
      skipPersist: true
    });
    
    return true;
  } catch (error) {
    console.error('[PersistenceManager] Failed to import session:', error);
    await addToChatHistory({
      type: 'system',
      content: `⚠️ Failed to import session: ${error.message}`,
      timestamp: Date.now(),
      skipPersist: true
    });
    return false;
  }
}

/**
 * Show file picker and import session
 * @returns {Promise<boolean>} Success status
 */
export async function importSessionWithPicker() {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    
    input.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (file) {
        const success = await importSessionFromFile(file);
        resolve(success);
      } else {
        resolve(false);
      }
    });
    
    input.click();
  });
}

// Initialize preference on module load
loadPersistencePreference();