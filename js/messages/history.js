/**
 * Message History module
 * Contains functions for managing the chat history
 */
import { updateChatDisplay } from '../ui/rendering.js';

// Chat history array to store all messages
let chatHistory = [];

// Map to store active request IDs and their metadata
let activeRequests = new Map();

// Current active request ID
let activeRequestId = null;

/**
 * Add a message to the chat history
 * @param {Object} message - The message to add
 */
function addToChatHistory(message) {
  // Generate requestId if not present and it's a user message
  if (message.type === 'user' && !message.requestId) {
    message.requestId = generateRequestId();
  }
  
  chatHistory.push(message);
  
  // Keep chat history at a reasonable size
  const MAX_HISTORY = 100;

  // If over 100 it will only return the latest 100
  if (chatHistory.length > MAX_HISTORY) {
    chatHistory = chatHistory.slice(-MAX_HISTORY);
  }
  
  // Update the chat display
  updateChatDisplay();
}

/**
 * Get the current chat history
 * @returns {Array} The chat history array
 */
function getChatHistory() {
  return chatHistory;
}

/**
 * Clear the chat history
 */
function clearChatHistory() {
  chatHistory = [];
  updateChatDisplay();
}

/**
 * Generate a unique request ID
 * @returns {string} A unique request ID
 */
function generateRequestId() {
  // In the original code, this used crypto.randomBytes
  // For simplicity, we'll use a simpler approach here
  return Math.random().toString(36).substring(2, 10) + 
         Math.random().toString(36).substring(2, 10);
}

/**
 * Set the active request ID
 * @param {string} requestId - The request ID to set as active
 */
function setActiveRequestId(requestId) {
  activeRequestId = requestId;
  console.log(`Setting activeRequestId to: ${requestId}`);
}

/**
 * Get the active request ID
 * @returns {string|null} The active request ID
 */
function getActiveRequestId() {
  return activeRequestId;
}

/**
 * Clear the active request ID
 */
function clearActiveRequestId() {
  console.log(`Clearing activeRequestId: ${activeRequestId}`);
  activeRequestId = null;
}

/**
 * Add a request to the active requests map
 * @param {string} requestId - The request ID
 * @param {Object} metadata - Metadata about the request
 */
function addActiveRequest(requestId, metadata) {
  activeRequests.set(requestId, {
    timestamp: Date.now(),
    ...metadata
  });
  console.log(`Added request to tracking: ${requestId}`);
  console.log(`Active requests: ${Array.from(activeRequests.keys()).join(', ')}`);
}

/**
 * Check if a request ID is active
 * @param {string} requestId - The request ID to check
 * @returns {boolean} True if the request is active
 */
function isActiveRequest(requestId) {
  return !requestId || 
    requestId === activeRequestId || 
    activeRequests.has(requestId);
}

/**
 * Get metadata for an active request
 * @param {string} requestId - The request ID
 * @returns {Object|null} The request metadata or null if not found
 */
function getActiveRequestMetadata(requestId) {
  return activeRequests.get(requestId) || null;
}

/**
 * Remove a request from the active requests map
 * @param {string} requestId - The request ID to remove
 */
function removeActiveRequest(requestId) {
  if (activeRequests.has(requestId)) {
    console.log(`Removing requestId ${requestId} from active requests`);
    activeRequests.delete(requestId);
  }
}

/**
 * Find the last message with a specific request ID
 * @param {string} requestId - The request ID to search for
 * @param {string} type - Optional message type to filter by
 * @returns {Object|null} The message or null if not found
 */
function findLastMessageByRequestId(requestId, type = null) {
  for (let i = chatHistory.length - 1; i >= 0; i--) {
    const message = chatHistory[i];
    if (message.requestId === requestId && (!type || message.type === type)) {
      return message;
    }
  }
  return null;
}

// Export functions
export {
  addToChatHistory,
  getChatHistory,
  clearChatHistory,
  generateRequestId,
  setActiveRequestId,
  getActiveRequestId,
  clearActiveRequestId,
  addActiveRequest,
  isActiveRequest,
  getActiveRequestMetadata,
  removeActiveRequest,
  findLastMessageByRequestId
};
