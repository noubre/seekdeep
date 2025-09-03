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

/**
 * Set up all event listeners for the UI
 */
function setupEventListeners() {
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

// Export functions
export {
  setupEventListeners,
  handleFormSubmit,
  handlePromptKeydown,
  handleJoinButtonClick,
  handleTopicKeyInputKeydown,
  handleProviderChange,
  handleRefreshModelsClick
};
