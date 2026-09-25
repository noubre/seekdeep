/**
 * In-memory chat message store (renderer).
 *
 * Pure data + change notification: no DOM and no imports from `ui/`. Views
 * subscribe and re-render; the worker owns request tracking and streaming.
 */

const MAX_HISTORY = 100;

let chatHistory = [];
const activeRequests = new Map();
const listeners = new Set();

function notify() {
  for (const listener of listeners) {
    try { listener(chatHistory); } catch { /* a view must not break the store */ }
  }
}

function subscribe(listener) {
  if (typeof listener !== 'function') throw new TypeError('subscribe requires a function');
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getHistory() {
  return chatHistory;
}

/**
 * Append a message and notify subscribers. Timestamps/ids are assigned by the
 * worker when absent so the same object identity is mutated during streaming.
 */
function addMessage(message) {
  if (!message || typeof message !== 'object') throw new TypeError('message must be an object');
  if (!message.timestamp) message.timestamp = Date.now();
  if (!message.id) message.id = `local-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  chatHistory.push(message);
  if (chatHistory.length > MAX_HISTORY) chatHistory = chatHistory.slice(-MAX_HISTORY);
  notify();
  return message;
}

function clear() {
  chatHistory = [];
  activeRequests.clear();
  notify();
}

function findLastMessageByRequestId(requestId, type = null) {
  if (!requestId) return null;
  for (let index = chatHistory.length - 1; index >= 0; index -= 1) {
    const message = chatHistory[index];
    if (message.requestId === requestId && (!type || message.type === type)) return message;
  }
  return null;
}

export {
  MAX_HISTORY,
  activeRequests,
  getHistory,
  addMessage,
  clear,
  notify,
  subscribe,
  findLastMessageByRequestId
};