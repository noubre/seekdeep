/**
 * Session export/import and search helpers (renderer, localStorage only).
 *
 * No Hyperbee/Hypercore: sessions are saved as JSON via `session/storage.js`.
 */
import { getHistory } from './store.js';
import { saveSession, listSessions, importSessionFromData } from './storage.js';
import { getSelectedModel, getSelectedProvider } from '../ui/elements.js';

let persistenceEnabled = true;

/**
 * Build a session snapshot from the in-memory message store.
 * @returns {Promise<Object|null>}
 */
export async function exportSession() {
  try {
    const messages = getHistory();
    const sessionData = {
      exportedAt: new Date().toISOString(),
      exportedTimestamp: Date.now(),
      messageCount: messages.length,
      messages,
      model: getSelectedModel(),
      provider: getSelectedProvider()
    };
    const savedMetadata = saveSession(sessionData);
    if (savedMetadata) console.log('[SessionStore] Session saved to localStorage:', savedMetadata.id);
    return sessionData;
  } catch (error) {
    console.error('[SessionStore] Failed to export session:', error);
    return null;
  }
}

/**
 * Download the current session as a JSON file and save it to localStorage.
 * @returns {Promise<boolean>}
 */
export async function downloadSessionExport() {
  try {
    const sessionData = await exportSession();
    if (!sessionData) return false;
    const blob = new Blob([JSON.stringify(sessionData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `seekdeep-session-${Date.now()}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
    return true;
  } catch (error) {
    console.error('[SessionStore] Failed to download export:', error);
    return false;
  }
}

/**
 * Search the in-memory message store.
 * @param {string} searchTerm
 * @returns {Promise<Array>}
 */
export async function searchMessages(searchTerm) {
  const term = String(searchTerm ?? '').toLowerCase();
  if (!term) return getHistory();
  return getHistory().filter((message) => (
    message.content?.toLowerCase().includes(term) || message.fromPeer?.toLowerCase().includes(term)
  ));
}

/**
 * Import a session from a JSON File object.
 * @param {File} file
 * @returns {Promise<boolean>}
 */
export async function importSessionFromFile(file) {
  try {
    const sessionData = JSON.parse(await file.text());
    if (!sessionData.messages || !Array.isArray(sessionData.messages)) throw new Error('Invalid session file format');
    const metadata = importSessionFromData(sessionData);
    if (!metadata) throw new Error('Failed to save session to storage');
    console.log('[SessionStore] Session imported:', metadata.id);
    return true;
  } catch (error) {
    console.error('[SessionStore] Failed to import session:', error);
    return false;
  }
}

/**
 * Show a file picker and import the chosen session.
 * @returns {Promise<boolean>}
 */
export async function importSessionWithPicker() {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.addEventListener('change', async (event) => {
      const file = event.target.files[0];
      resolve(file ? await importSessionFromFile(file) : false);
    });
    input.click();
  });
}

/**
 * Load the persisted enable/disable preference from localStorage.
 */
export function loadPersistencePreference() {
  if (typeof localStorage === 'undefined') return;
  const saved = localStorage.getItem('seekdeep-persistence-enabled');
  if (saved !== null) persistenceEnabled = saved === 'true';
}

/**
 * Persist the enable/disable preference.
 * @param {boolean} enabled
 */
export function setPersistenceEnabled(enabled) {
  persistenceEnabled = Boolean(enabled);
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem('seekdeep-persistence-enabled', persistenceEnabled.toString());
  }
}

/**
 * @returns {Array} Saved session metadata.
 */
export function listSavedSessions() {
  return listSessions();
}

loadPersistencePreference();