/**
 * Chat Persistence Module using Hyperbee
 * Provides persistent storage for chat messages across sessions
 */
import Hyperbee from 'hyperbee';
import Hypercore from 'hypercore';
import RAM from 'random-access-memory';

/**
 * ChatPersistence class manages persistent storage of chat messages
 */
export class ChatPersistence {
  /**
   * Create a new ChatPersistence instance
   * @param {string} sessionTopic - The session topic identifier
   * @param {Object} options - Configuration options
   * @param {boolean} options.enabled - Whether persistence is enabled
   * @param {string} options.storagePath - Custom storage path
   */
  constructor(sessionTopic, options = {}) {
    this.sessionTopic = sessionTopic;
    this.enabled = options.enabled !== false;
    this.storagePath = options.storagePath || this.getDefaultStoragePath();
    this.db = null;
    this.core = null;
    this.ready = false;
    this.messageCount = 0;
  }

  /**
   * Initialize the Hyperbee database
   * @returns {Promise<void>}
   */
  async initialize() {
    if (!this.enabled) {
      console.log('[Persistence] Disabled by configuration');
      return;
    }

    try {
      // Create Hypercore with in-memory storage (browser environment)
      // Create a unique RAM instance for each file Hypercore requests
      // This prevents path.join errors while keeping everything in memory
      const storageFactory = (filename) => {
        console.log(`[Persistence] Creating RAM storage for: ${filename}`);
        return RAM();
      };
      
      this.core = new Hypercore(storageFactory);

      // Create Hyperbee on top of Hypercore
      this.db = new Hyperbee(this.core, {
        keyEncoding: 'utf-8',
        valueEncoding: 'json'
      });

      await this.db.ready();
      this.ready = true;
      
      // Count existing messages
      this.messageCount = await this.countMessages();
      
      console.log(`[Persistence] Initialized for session ${this.sessionTopic.substring(0, 8)}...`);
      console.log(`[Persistence] Storage: In-memory (RAM)`);
      console.log(`[Persistence] Existing messages: ${this.messageCount}`);
      console.log(`[Persistence] Note: Using in-memory storage - data will be lost on page reload`);
    } catch (error) {
      console.error('[Persistence] Initialization failed:', error);
      this.ready = false;
      this.enabled = false;
    }
  }

  /**
   * Save a message to persistent storage
   * @param {Object} message - The message to save
   * @returns {Promise<boolean>} Success status
   */
  async saveMessage(message) {
    if (!this.ready || !this.enabled) {
      return false;
    }

    try {
      const key = this.createMessageKey(message);
      const persistentMessage = {
        ...message,
        persisted: Date.now(),
        sessionTopic: this.sessionTopic
      };

      await this.db.put(key, persistentMessage);
      this.messageCount++;
      
      return true;
    } catch (error) {
      console.error('[Persistence] Failed to save message:', error);
      return false;
    }
  }

  /**
   * Load messages from persistent storage
   * @param {Object} options - Load options
   * @param {number} options.limit - Maximum number of messages to load
   * @param {number} options.after - Load messages after this timestamp
   * @param {number} options.before - Load messages before this timestamp
   * @returns {Promise<Array>} Array of messages
   */
  async loadMessages(options = {}) {
    if (!this.ready || !this.enabled) {
      return [];
    }

    const { limit = 100, after, before } = options;
    const messages = [];

    try {
      const streamOptions = {
        reverse: true,
        limit
      };

      if (after) {
        streamOptions.gt = this.createTimeKey(after);
      }
      if (before) {
        streamOptions.lt = this.createTimeKey(before);
      }

      for await (const { value } of this.db.createReadStream(streamOptions)) {
        messages.push(value);
      }

      console.log(`[Persistence] Loaded ${messages.length} messages`);
      return messages.reverse(); // Return in chronological order
    } catch (error) {
      console.error('[Persistence] Failed to load messages:', error);
      return [];
    }
  }

  /**
   * Search messages by content or peer name
   * @param {string} searchTerm - The term to search for
   * @param {Object} options - Search options
   * @param {number} options.limit - Maximum results to return
   * @returns {Promise<Array>} Array of matching messages
   */
  async searchMessages(searchTerm, options = {}) {
    if (!this.ready || !this.enabled) {
      return [];
    }

    const { limit = 50 } = options;
    const results = [];
    const term = searchTerm.toLowerCase();

    try {
      for await (const { value } of this.db.createReadStream()) {
        if (this.messageMatches(value, term)) {
          results.push(value);
          if (results.length >= limit) break;
        }
      }

      console.log(`[Persistence] Found ${results.length} matching messages for "${searchTerm}"`);
      return results;
    } catch (error) {
      console.error('[Persistence] Search failed:', error);
      return [];
    }
  }

  /**
   * Count total messages in storage
   * @returns {Promise<number>} Message count
   */
  async countMessages() {
    if (!this.ready || !this.enabled) {
      return 0;
    }

    let count = 0;
    try {
      for await (const _ of this.db.createReadStream()) {
        count++;
      }
      return count;
    } catch (error) {
      console.error('[Persistence] Count failed:', error);
      return 0;
    }
  }

  /**
   * Clear all messages for this session
   * @returns {Promise<boolean>} Success status
   */
  async clear() {
    if (!this.ready || !this.enabled) {
      return false;
    }

    try {
      for await (const { key } of this.db.createReadStream()) {
        await this.db.del(key);
      }
      this.messageCount = 0;
      console.log('[Persistence] Cleared all messages');
      return true;
    } catch (error) {
      console.error('[Persistence] Clear failed:', error);
      return false;
    }
  }

  /**
   * Export session to JSON
   * @returns {Promise<Object>} Exported session data
   */
  async exportSession() {
    const messages = await this.loadMessages({ limit: Infinity });
    
    return {
      sessionTopic: this.sessionTopic,
      exportedAt: new Date().toISOString(),
      exportedTimestamp: Date.now(),
      messageCount: messages.length,
      messages: messages
    };
  }

  /**
   * Import messages from exported session
   * @param {Object} sessionData - Exported session data
   * @returns {Promise<number>} Number of imported messages
   */
  async importSession(sessionData) {
    if (!this.ready || !this.enabled) {
      return 0;
    }

    let imported = 0;
    try {
      for (const message of sessionData.messages) {
        await this.saveMessage(message);
        imported++;
      }
      console.log(`[Persistence] Imported ${imported} messages`);
      return imported;
    } catch (error) {
      console.error('[Persistence] Import failed:', error);
      return imported;
    }
  }

  /**
   * Close the database and release resources
   * @returns {Promise<void>}
   */
  async close() {
    if (this.db) {
      try {
        await this.db.close();
        console.log('[Persistence] Database closed');
      } catch (error) {
        console.error('[Persistence] Failed to close database:', error);
      }
    }
    this.ready = false;
  }

  /**
   * Get storage statistics
   * @returns {Promise<Object>} Storage statistics
   */
  async getStats() {
    return {
      enabled: this.enabled,
      ready: this.ready,
      sessionTopic: this.sessionTopic,
      storagePath: this.storagePath,
      messageCount: this.messageCount
    };
  }

  // Helper methods

  /**
   * Create a unique key for a message
   * @param {Object} message - The message object
   * @returns {string} Hyperbee key
   */
  createMessageKey(message) {
    const timestamp = message.timestamp || Date.now();
    const id = message.id || this.generateId();
    return `msg:${timestamp}:${id}`;
  }

  /**
   * Create a time-based key for range queries
   * @param {number} timestamp - Unix timestamp
   * @returns {string} Time-based key
   */
  createTimeKey(timestamp) {
    return `msg:${timestamp}`;
  }

  /**
   * Check if a message matches the search term
   * @param {Object} message - The message to check
   * @param {string} term - Search term (lowercase)
   * @returns {boolean} Whether the message matches
   */
  messageMatches(message, term) {
    // Search in message content
    if (message.content && message.content.toLowerCase().includes(term)) {
      return true;
    }
    
    // Search in peer name
    if (message.fromPeer && message.fromPeer.toLowerCase().includes(term)) {
      return true;
    }
    
    // Search in message type
    if (message.type && message.type.toLowerCase().includes(term)) {
      return true;
    }
    
    return false;
  }

  /**
   * Generate a random ID
   * @returns {string} Random ID
   */
  generateId() {
    return Math.random().toString(36).substring(2, 15) +
           Math.random().toString(36).substring(2, 15);
  }

  /**
   * Get the default storage path for this session
   * @returns {string} Storage path
   */
  getDefaultStoragePath() {
    // In browser environment, return a logical path identifier
    // (actual storage is in RAM for now)
    return `seekdeep-history-${this.sessionTopic}`;
  }

  /**
   * Check if persistence is available and ready
   * @returns {boolean} Ready status
   */
  isReady() {
    return this.enabled && this.ready;
  }
}

/**
 * Get a list of all stored sessions
 * @returns {Promise<Array>} Array of session info
 */
export async function listStoredSessions() {
  // This would require reading the history directory
  // Implementation depends on whether we're in browser or Node.js context
  return [];
}

/**
 * Delete a stored session
 * @param {string} sessionTopic - The session to delete
 * @returns {Promise<boolean>} Success status
 */
export async function deleteStoredSession(sessionTopic) {
  // Implementation would delete the session directory
  return false;
}

export default ChatPersistence;