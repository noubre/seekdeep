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
  chatModeSelect,
  chatMessagesEl
} from './elements.js';
import { addMessage, clear } from '../messages/store.js';
import { dispatchSlashTag } from '../slash/registry.js';
import { createEphemeralRenderer } from './ephemeral.js';
import { routePromptSubmission } from './submit-routing.js';
import { createSwarmService } from '../slash/services/swarm.js';
import { createDHTService } from '../slash/services/dht.js';
import { createDriveService } from '../slash/services/drive.js';
import { createLocaldriveService } from '../slash/services/localdrive.js';
import { createMirrorService } from '../slash/services/mirror.js';
import { createBeamService } from '../slash/services/beam.js';
import { createChatSlashService } from '../slash/services/chat.js';
import * as sessionStore from '../session/session-store.js';
import { clearAllSessions } from '../session/storage.js';
import * as historyBrowser from './history-browser.js';

function systemMessage(content) {
  addMessage({ type: 'system', content });
}

function slashServices(chatClient) {
  const client = chatClient.rpc;
  return {
    swarm: createSwarmService(client),
    dht: createDHTService(client),
    drive: createDriveService(client),
    localdrive: createLocaldriveService(client),
    mirror: createMirrorService(client),
    beam: createBeamService(client),
    chat: createChatSlashService(client)
  };
}

/**
 * Wire DOM event listeners. `chatClient` and `clientState` are injected by main.
 */
function setupEventListeners({ chatClient, clientState } = {}) {
  if (!chatClient || !chatClient.api) throw new TypeError('setupEventListeners requires a chat client');
  const services = slashServices(chatClient);

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
  if (persistenceCheckbox) persistenceCheckbox.addEventListener('change', handlePersistenceToggle);
  if (exportButton) exportButton.addEventListener('click', handleExportHistory);
  if (clearButton) clearButton.addEventListener('click', handleClearHistory);

  if (form) form.addEventListener('submit', (event) => handleFormSubmit(event, chatClient, services));
  if (promptArea) promptArea.addEventListener('keydown', handlePromptKeydown);
  if (joinButton) joinButton.addEventListener('click', () => handleJoinButtonClick(chatClient));
  if (topicKeyInput) topicKeyInput.addEventListener('keydown', handleTopicKeyInputKeydown);

  if (chatModeSelect) {
    chatModeSelect.addEventListener('change', () => handleChatModeChange(chatClient, clientState));
    chatModeSelect.value = clientState?.getState().collaborative ? 'collaborative' : 'private';
    chatModeSelect.disabled = clientState?.getState().role !== 'host';
  }
  if (providerSelect) providerSelect.addEventListener('change', () => handleProviderChange(chatClient));
  if (refreshModelsButton) refreshModelsButton.addEventListener('click', () => handleRefreshModelsClick(chatClient));
}

async function handleFormSubmit(event, chatClient, services) {
  event.preventDefault();
  const prompt = getPromptValue();
  if (prompt.length === 0) return;
  const emitEphemeral = createEphemeralRenderer(chatMessagesEl);
  await routePromptSubmission(prompt, {
    dispatchSlashTag,
    emitEphemeral,
    services,
    getSelectedModel,
    clearPromptArea,
    ask: (model, text) => chatClient.api.send({ prompt: text, model })
  });
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