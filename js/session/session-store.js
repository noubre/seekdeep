/**
 * Session export/import and search helpers (renderer, localStorage only).
 *
 * No Hyperbee/Hypercore: sessions are saved as JSON via `session/storage.js`.
 */
import { getHistory } from '../messages/store.js';
import { saveSession } from './storage.js';
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
    let savedMetadata = null;
    if (persistenceEnabled) {
      savedMetadata = saveSession(sessionData);
      if (savedMetadata) console.log('[SessionStore] Session saved to localStorage:', savedMetadata.id);
    }
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
 * Load the persisted enable/disable preference from localStorage.
 */
export function loadPersistencePreference() {
  if (typeof localStorage === 'undefined') return;
  const saved = localStorage.getItem('seekdeep-persistence-enabled');
  if (saved !== null) persistenceEnabled = saved === 'true';
}

/**
 * @returns {boolean} Whether exported sessions are kept in localStorage.
 */
export function isPersistenceEnabled() {
  return persistenceEnabled;
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

loadPersistencePreference();