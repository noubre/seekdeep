/**
 * UI Events module
 * Contains event listeners and handlers for UI interactions
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
  setSelectedProvider,
  clearPromptArea,
  getTopicKeyValue,
  clearTopicKeyInput,
  setRefreshModelsLoading,
  updateRefreshModelsTooltip
} from './elements.js';
import { addToChatHistory } from '../messages/history.js';
import { joinExistingChat } from '../network/hyperswarm.js';
import { isSessionHost } from '../session/modes.js';
import { fetchAvailableModels, requestModelsFromHost } from '../llm/models.js';
import { ask, setCurrentProvider } from '../llm/provider.js';
import * as persistenceManager from '../messages/persistence-manager.js';
import * as historyBrowser from './history-browser.js';

/**
 * Set up all event listeners for the UI
 */
function setupEventListeners() {
  // History browser handlers
  const historyToggle = document.getElementById('history-toggle');
  const historyClose = document.getElementById('history-close');
  const historyOverlay = document.getElementById('history-overlay');
  const sessionSearch = document.getElementById('session-search');
  
  if (historyToggle) {
    historyToggle.addEventListener('click', handleHistoryToggle);
  }
  
  if (historyClose) {
    historyClose.addEventListener('click', handleHistoryToggle);
  }
  
  if (historyOverlay) {
    historyOverlay.addEventListener('click', handleHistoryToggle);
  }
  
  if (sessionSearch) {
    sessionSearch.addEventListener('input', handleSessionSearch);
  }
  
  // Persistence control handlers
  const persistenceCheckbox = document.getElementById('persistence-enabled');
  const exportButton = document.getElementById('export-history');
  const clearButton = document.getElementById('clear-history');
  
  if (persistenceCheckbox) {
    persistenceCheckbox.addEventListener('change', handlePersistenceToggle);
  }
  
  if (exportButton) {
    exportButton.addEventListener('click', handleExportHistory);
  }
  
  if (clearButton) {
    clearButton.addEventListener('click', handleClearHistory);
  }
  
  // Form submission handler
  if (form) {
    form.addEventListener('submit', handleFormSubmit);
  }
  
  // Prompt area keyboard shortcuts
  if (promptArea) {
    promptArea.addEventListener('keydown', handlePromptKeydown);
  }
  
  // Join button click handler
  if (joinButton) {
    joinButton.addEventListener('click', handleJoinButtonClick);
  }
  
  // Topic key input Enter key handler
  if (topicKeyInput) {
    topicKeyInput.addEventListener('keydown', handleTopicKeyInputKeydown);
  }
  
  // Chat mode selector has been removed - no longer needed
  
  // Provider selection change handler
  if (providerSelect) {
    providerSelect.addEventListener('change', handleProviderChange);
  }
  
  // Refresh models button click handler
  if (refreshModelsButton) {
    refreshModelsButton.addEventListener('click', handleRefreshModelsClick);
  }
}

/**
 * Handle form submission (sending a message)
 * @param {Event} event - The form submit event
 */
async function handleFormSubmit(event) {
  event.preventDefault();
  
  const prompt = getPromptValue();
  if (prompt.length === 0) {
    return;
  }
  
  // Get the selected model
  const model = getSelectedModel();
  
  // Clear the prompt area
  clearPromptArea();
  
  // Process the prompt (this will add messages to chat history)
  await ask(model, prompt);
}

/**
 * Handle keyboard shortcuts in the prompt area
 * @param {KeyboardEvent} event - The keydown event
 */
function handlePromptKeydown(event) {
  // Ctrl+Enter or Cmd+Enter to submit
  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
    form.dispatchEvent(new Event('submit'));
  } 
  // Enter without Shift to submit (Shift+Enter for new line)
  else if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    form.dispatchEvent(new Event('submit'));
  }
}

/**
 * Handle join button click
 */
function handleJoinButtonClick() {
  const topicKeyHex = getTopicKeyValue();
  if (topicKeyHex) {
    const success = joinExistingChat(topicKeyHex);
    if (success) {
      // Clear the input after joining
      clearTopicKeyInput();
    } else {
      // If joining failed, show an error message
      addToChatHistory({
        type: 'system',
        content: 'Failed to join chat session. Please check the topic key and try again.'
      });
    }
  } else {
    addToChatHistory({
      type: 'system',
      content: 'Please enter a valid topic key to join a chat session.'
    });
  }
}

/**
 * Handle Enter key in topic key input
 * @param {KeyboardEvent} event - The keydown event
 */
function handleTopicKeyInputKeydown(event) {
  if (event.key === 'Enter') {
    event.preventDefault();
    joinButton.click();
  }
}


/**
 * Handle provider selection change
 */
function handleProviderChange() {
  const selectedProvider = getSelectedProvider();
  console.log(`Provider changed to: ${selectedProvider}`);
  
  // Update the provider in the provider abstraction layer
  setCurrentProvider(selectedProvider);
  
  // Show a system message about the provider change
  addToChatHistory({
    type: 'system',
    content: `Switched to ${selectedProvider === 'ollama' ? 'Ollama' : 'LM Studio'} provider`
  });
  
  // Refresh models for the new provider
  setRefreshModelsLoading(true);
  
  fetchAvailableModels()
    .then(() => {
      addToChatHistory({
        type: 'system',
        content: `Loaded models from ${selectedProvider === 'ollama' ? 'Ollama' : 'LM Studio'}`
      });
    })
    .catch(error => {
      addToChatHistory({
        type: 'system',
        content: `Error loading models from ${selectedProvider === 'ollama' ? 'Ollama' : 'LM Studio'}: ${error.message}`
      });
    })
    .finally(() => {
      setRefreshModelsLoading(false);
    });
}

/**
 * Handle refresh models button click
 */
function handleRefreshModelsClick() {
  // Add a visual indication that refresh is happening
  setRefreshModelsLoading(true);
  
  // Show a system message in the chat
  addToChatHistory({
    type: 'system',
    content: 'Refreshing available models...'
  });
  
  // If we're connected as a peer to a host, we should request models from the host
  if (!isSessionHost() && requestModelsFromHost()) {
    // Set a timeout to clear loading state if no response is received
    setTimeout(() => {
      // Check if we're still loading (models weren't received)
      if (refreshModelsButton && refreshModelsButton.classList.contains('refreshing')) {
        setRefreshModelsLoading(false);
        addToChatHistory({
          type: 'system',
          content: 'Timeout waiting for models from host. Please try again.'
        });
        updateRefreshModelsTooltip('Request timed out');
      }
    }, 10000); // 10 second timeout
    
    // The actual refresh will happen when we receive the models from the host
    return;
  }
  
  // Fetch the models
  fetchAvailableModels()
    .then(() => {
      // Add success message
      addToChatHistory({
        type: 'system',
        content: 'Model list refreshed successfully!'
      });
    })
    .catch(error => {
      // Add error message
      addToChatHistory({
        type: 'system',
        content: `Error refreshing models: ${error.message}`
      });
    })
    .finally(() => {
      // Remove visual indication
      setRefreshModelsLoading(false);
      // Update timestamp on refresh button
      updateRefreshModelsTooltip(`Last refreshed: ${new Date().toLocaleTimeString()}`);
    });
}

/**
 * Handle persistence toggle checkbox
 * @param {Event} event - The change event
 */
function handlePersistenceToggle(event) {
  const enabled = event.target.checked;
  persistenceManager.setPersistenceEnabled(enabled);
  
  addToChatHistory({
    type: 'system',
    content: `💾 Chat history persistence ${enabled ? 'enabled' : 'disabled'}`
  });
}

/**
 * Handle export history button click
 */
async function handleExportHistory() {
  try {
    const success = await persistenceManager.downloadSessionExport();
    if (!success) {
      addToChatHistory({
        type: 'system',
        content: '⚠️ Failed to export chat history'
      });
    }
  } catch (error) {
    console.error('Export error:', error);
    addToChatHistory({
      type: 'system',
      content: `⚠️ Error exporting history: ${error.message}`
    });
  }
}

/**
 * Handle clear history button click
 */
async function handleClearHistory() {
  // Confirm with user
  const confirmed = confirm('Are you sure you want to clear all saved chat history? This cannot be undone.');
  
  if (!confirmed) {
    return;
  }
  
  try {
    const success = await persistenceManager.clearPersistedMessages();
    if (!success) {
      addToChatHistory({
        type: 'system',
        content: '⚠️ Failed to clear chat history' 
      });
    }
  } catch (error) {
    console.error('Clear error:', error);
    addToChatHistory({
      type: 'system',
      content: `⚠️ Error clearing history: ${error.message}`
    });
  }
}

/**
 * Handle history browser toggle
 */
function handleHistoryToggle() {
  historyBrowser.toggleHistoryBrowser();
}

/**
 * Handle session search input
 * @param {Event} event - The input event
 */
function handleSessionSearch(event) {
  const query = event.target.value;
  historyBrowser.handleSessionSearch(query);
}

// Export functions
export {
  setupEventListeners,
  handleFormSubmit,
  handlePromptKeydown,
  handleJoinButtonClick,
  handleTopicKeyInputKeydown,
  handleProviderChange,
  handleRefreshModelsClick,
  handlePersistenceToggle,
  handleExportHistory,
  handleClearHistory,
  handleHistoryToggle,
  handleSessionSearch
};