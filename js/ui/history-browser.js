/**
 * History Browser UI Module
 * Manages the sidebar UI for browsing and loading past chat sessions
 */
import { listSessions, loadSession, deleteSession, searchSessions, getStorageStats } from '../session/storage.js';
import { addMessage, clear } from '../messages/store.js';
import { escapeHtml } from '../messages/formatting.js';

// State
let isHistoryBrowserOpen = false;
let currentSearchQuery = '';

/**
 * Initialize the history browser
 */
export function initializeHistoryBrowser() {
  // Browser is created in HTML; its closed state lives in CSS. Re-assert the
  // closed classes so a reused document cannot start with a stale open state.
  const sidebar = document.getElementById('history-sidebar');
  const overlay = document.getElementById('history-overlay');
  if (sidebar) sidebar.classList.remove('open');
  if (overlay) overlay.classList.remove('open');
}

/**
 * Toggle the history browser sidebar
 */
export function toggleHistoryBrowser() {
  const sidebar = document.getElementById('history-sidebar');
  const overlay = document.getElementById('history-overlay');
  
  if (!sidebar || !overlay) {
    console.error('[HistoryBrowser] Sidebar or overlay not found');
    return;
  }
  
  isHistoryBrowserOpen = !isHistoryBrowserOpen;
  
  sidebar.classList.toggle('open', isHistoryBrowserOpen);
  overlay.classList.toggle('open', isHistoryBrowserOpen);

  if (isHistoryBrowserOpen) {
    // Render session list
    renderSessionList();
  }
}

/**
 * Render the list of saved sessions
 */
function renderSessionList() {
  const sessionList = document.getElementById('session-list');
  if (!sessionList) {
    console.error('[HistoryBrowser] Session list container not found');
    return;
  }
  
  // Get sessions (filtered by search if applicable)
  const sessions = currentSearchQuery ? 
                   searchSessions(currentSearchQuery) : 
                   listSessions();
  
  // Clear current list
  sessionList.innerHTML = '';
  
  if (sessions.length === 0) {
    sessionList.innerHTML = `
      <div class="no-sessions">
        <p>${currentSearchQuery ? 'No matching sessions found' : 'No saved sessions yet'}</p>
        <p class="hint">Export a chat to save it to history</p>
      </div>
    `;
    updateStorageInfo();
    return;
  }
  
  // Render each session
  sessions.forEach(session => {
    const sessionEl = createSessionElement(session);
    sessionList.appendChild(sessionEl);
  });
  
  // Update storage info
  updateStorageInfo();
}

/**
 * Create a session element
 * @param {Object} session - Session metadata
 * @returns {HTMLElement} Session element
 */
function createSessionElement(session) {
  const div = document.createElement('div');
  div.className = 'session-item';
  div.dataset.sessionId = session.id;
  
  const date = new Date(session.timestamp);
  const dateStr = date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });
  const timeStr = date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  });
  
  div.innerHTML = `
    <div class="session-header">
      <div class="session-title">${escapeHtml(session.name)}</div>
      <div class="session-meta">
        ${dateStr} • ${timeStr}
      </div>
    </div>
    <div class="session-preview">${escapeHtml(session.preview)}</div>
    <div class="session-info">
      <span class="session-messages">${session.messageCount} messages</span>
      <span class="session-model">${escapeHtml(session.model)}</span>
    </div>
    <div class="session-actions">
      <button class="session-load-btn" data-session-id="${session.id}">
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
          <polyline points="17 8 12 3 7 8"></polyline>
          <line x1="12" y1="3" x2="12" y2="15"></line>
        </svg>
        Load
      </button>
      <button class="session-delete-btn" data-session-id="${session.id}">
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="3 6 5 6 21 6"></polyline>
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
        </svg>
        Delete
      </button>
    </div>
  `;
  
  // Add event listeners
  const loadBtn = div.querySelector('.session-load-btn');
  const deleteBtn = div.querySelector('.session-delete-btn');
  
  if (loadBtn) {
    loadBtn.addEventListener('click', () => handleSessionLoad(session.id));
  }
  
  if (deleteBtn) {
    deleteBtn.addEventListener('click', () => handleSessionDelete(session.id));
  }
  
  return div;
}

/**
 * Handle loading a session
 * @param {string} sessionId - The session ID to load
 */
async function handleSessionLoad(sessionId) {
  // Confirm with user
  const confirmed = confirm('Load this session? This will replace your current chat.');
  
  if (!confirmed) {
    return;
  }
  
  // Load session data
  const sessionData = loadSession(sessionId);
  
  if (!sessionData) {
    alert('Failed to load session. It may have been deleted.');
    renderSessionList(); // Refresh list
    return;
  }
  
  // Clear current history
  clear();
  
  // Load messages from session
  if (sessionData.messages && Array.isArray(sessionData.messages)) {
    for (const message of sessionData.messages) {
      await addMessage(message);
    }
  }
  
  // Add system message
  await addMessage({
    type: 'system',
    content: `📂 Loaded session: ${sessionData.name || 'Untitled'} (${sessionData.messageCount || 0} messages)`,
    timestamp: Date.now()
  });
  
  // Close sidebar
  toggleHistoryBrowser();
  
  console.log(`[HistoryBrowser] Session loaded: ${sessionId}`);
}

/**
 * Handle deleting a session
 * @param {string} sessionId - The session ID to delete
 */
function handleSessionDelete(sessionId) {
  // Confirm with user
  const confirmed = confirm('Delete this session? This cannot be undone.');
  
  if (!confirmed) {
    return;
  }
  
  // Delete session
  const success = deleteSession(sessionId);
  
  if (success) {
    // Refresh session list
    renderSessionList();
    console.log(`[HistoryBrowser] Session deleted: ${sessionId}`);
  } else {
    alert('Failed to delete session. Please try again.');
  }
}

/**
 * Handle search input
 * @param {string} query - Search query
 */
export function handleSessionSearch(query) {
  currentSearchQuery = query.trim();
  renderSessionList();
}

/**
 * Update storage information display
 */
function updateStorageInfo() {
  const stats = getStorageStats();
  const countEl = document.getElementById('storage-session-count');
  const sizeEl = document.getElementById('storage-size');
  if (countEl) countEl.textContent = `${stats.sessionCount} sessions`;
  if (sizeEl) sizeEl.textContent = `${stats.totalSizeKB} KB used`;
}

/**
 * Check if history browser is open
 * @returns {boolean} Open state
 */
export function isOpen() {
  return isHistoryBrowserOpen;
}

