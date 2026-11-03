/**
 * UI Events module.
 *
 * The renderer is a view/controller: every network or provider action is a
 * JSON-RPC call through `chatClient`; state arrives back as `chat.event`s and
 * is rendered by the store/client-state subscribers.
 */
import {
  form,
  promptArea,
  joinButton,
  topicKeyInput,
  refreshModelsButton,
  providerSelect,
  getPromptValue,
  getSelectedModel,
  getSelectedProvider,
  clearPromptArea,
  getTopicKeyValue,
  clearTopicKeyInput,
  setRefreshModelsLoading,
  updateRefreshModelsTooltip,
  chatModeSelect
} from './elements.js';
import { addMessage, clear } from '../messages/store.js';
import { routePromptSubmission } from './submit-routing.js';
import * as sessionStore from '../session/session-store.js';
import { clearAllSessions } from '../session/storage.js';
import * as historyBrowser from './history-browser.js';

function systemMessage(content) {
  addMessage({ type: 'system', content });
}

/**
 * Only one composer submission may be in flight at a time. Rapid duplicate
 * submits (double Enter/click) arrive while the first send is awaited and must
 * not fan out into a second slash dispatch or worker send.
 */
let submissionInFlight = false;

/**
 * Resolves once the initial room is ready (`{ ok }`). Submits await it once so a
 * prompt typed immediately after load cannot race `chat.send` ahead of `chat.join`.
 */
let pendingRoom = null;

/**
 * Wire DOM event listeners. `chatClient` and `clientState` are injected by main.
 */
function setupEventListeners({ chatClient, clientState, roomReady } = {}) {
  if (!chatClient || !chatClient.api) throw new TypeError('setupEventListeners requires a chat client');

  pendingRoom = roomReady || null;

  const historyToggle = document.getElementById('history-toggle');
  const historyClose = document.getElementById('history-close');
  const historyOverlay = document.getElementById('history-overlay');
  const sessionSearch = document.getElementById('session-search');
  if (historyToggle) historyToggle.addEventListener('click', handleHistoryToggle);
  if (historyClose) historyClose.addEventListener('click', handleHistoryToggle);
  if (historyOverlay) historyOverlay.addEventListener('click', handleHistoryToggle);
  if (sessionSearch) sessionSearch.addEventListener('input', handleSessionSearch);

  const persistenceCheckbox = document.getElementById('persistence-enabled');
  const exportButton = document.getElementById('export-history');
  const clearButton = document.getElementById('clear-history');
  if (persistenceCheckbox) persistenceCheckbox.checked = sessionStore.isPersistenceEnabled();
  if (persistenceCheckbox) persistenceCheckbox.addEventListener('change', handlePersistenceToggle);
  if (exportButton) exportButton.addEventListener('click', handleExportHistory);
  if (clearButton) clearButton.addEventListener('click', handleClearHistory);

  if (form) form.addEventListener('submit', (event) => handleFormSubmit(event, chatClient));
  if (promptArea) promptArea.addEventListener('keydown', handlePromptKeydown);
  if (joinButton) joinButton.addEventListener('click', () => handleJoinButtonClick(chatClient));
  if (topicKeyInput) topicKeyInput.addEventListener('keydown', handleTopicKeyInputKeydown);

  if (chatModeSelect) {
    chatModeSelect.addEventListener('change', () => handleChatModeChange(chatClient, clientState));
  }
  if (providerSelect) providerSelect.addEventListener('change', () => handleProviderChange(chatClient));
  if (refreshModelsButton) refreshModelsButton.addEventListener('click', () => handleRefreshModelsClick(chatClient));
}

async function handleFormSubmit(event, chatClient) {
  event.preventDefault();
  const prompt = getPromptValue();
  if (prompt.length === 0) return;
  if (submissionInFlight) return;

  submissionInFlight = true;
  try {
    if (pendingRoom) {
      const settled = await pendingRoom;
      pendingRoom = null;
      if (!settled?.ok) {
        systemMessage('The chat room is not ready yet. Try again in a moment.');
        return; // the draft is intentionally kept
      }
    }
    await routePromptSubmission(prompt, {
      dispatchSlash: (text) => chatClient.dispatchSlash(text),
      getSelectedModel,
      // Clear only when the composer still holds the submitted draft: a new
      // draft typed while the send was pending must survive completion.
      clearPromptArea: () => {
        if (getPromptValue() === prompt) clearPromptArea();
      },
      ask: (model, text) => chatClient.api.send({ prompt: text, model })
    });
  } catch (error) {
    const message = error?.message || 'unknown send error';
    systemMessage(`Could not send message: ${message}`);
  } finally {
    submissionInFlight = false;
  }
}

function handlePromptKeydown(event) {
  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
    form.dispatchEvent(new Event('submit'));
  } else if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    form.dispatchEvent(new Event('submit'));
  }
}

function handleJoinButtonClick(chatClient) {
  const topicKeyHex = getTopicKeyValue();
  if (!topicKeyHex) {
    systemMessage('Please enter a valid topic key to join a chat session.');
    return;
  }
  chatClient.api.join({ topic: topicKeyHex }).then(() => {
    clearTopicKeyInput();
  }).catch((error) => {
    systemMessage(`Failed to join chat session: ${error.message}`);
  });
}

function handleTopicKeyInputKeydown(event) {
  if (event.key === 'Enter') {
    event.preventDefault();
    joinButton.click();
  }
}

function handleChatModeChange(chatClient) {
  const requestedMode = chatModeSelect ? chatModeSelect.value === 'collaborative' : false;
  chatClient.api.setMode({ collaborative: requestedMode }).catch((error) => {
    systemMessage(`Only the host can change chat mode (${error.message}).`);
  });
}

function handleProviderChange(chatClient) {
  const selectedProvider = getSelectedProvider();
  setRefreshModelsLoading(true);
  chatClient.api.setProvider({ provider: selectedProvider }).catch((error) => {
    systemMessage(`Could not switch provider: ${error.message}`);
  }).finally(() => setRefreshModelsLoading(false));
}

function handleRefreshModelsClick(chatClient) {
  setRefreshModelsLoading(true);
  systemMessage('Refreshing available models...');
  chatClient.api.refreshModels().catch((error) => {
    systemMessage(`Error refreshing models: ${error.message}`);
  }).finally(() => {
    setRefreshModelsLoading(false);
    updateRefreshModelsTooltip(`Last refreshed: ${new Date().toLocaleTimeString()}`);
  });
}

function handlePersistenceToggle(event) {
  const enabled = event.target.checked;
  sessionStore.setPersistenceEnabled(enabled);
  systemMessage(`💾 Chat history persistence ${enabled ? 'enabled' : 'disabled'}`);
}

async function handleExportHistory() {
  try {
    const success = await sessionStore.downloadSessionExport();
    if (!success) systemMessage('⚠️ Failed to export chat history');
  } catch (error) {
    systemMessage(`⚠️ Error exporting history: ${error.message}`);
  }
}

async function handleClearHistory() {
  if (!confirm('Are you sure you want to clear all saved chat history? This cannot be undone.')) return;
  try {
    clear();
    clearAllSessions();
  } catch (error) {
    systemMessage(`⚠️ Error clearing history: ${error.message}`);
  }
}

function handleHistoryToggle() {
  historyBrowser.toggleHistoryBrowser();
}

function handleSessionSearch(event) {
  historyBrowser.handleSessionSearch(event.target.value);
}

export {
  setupEventListeners,
  handleFormSubmit,
  handlePromptKeydown,
  handleJoinButtonClick,
  handleTopicKeyInputKeydown,
  handleChatModeChange,
  handleProviderChange,
  handleRefreshModelsClick,
  handlePersistenceToggle,
  handleExportHistory,
  handleClearHistory,
  handleHistoryToggle,
  handleSessionSearch
};