/**
 * UI Events module
 * Contains event listeners and handlers for UI interactions
 */
import { 
  form, 
  promptArea, 
  joinButton, 
  topicKeyInput, 
  chatModeSelect, 
  refreshModelsButton,
  getPromptValue,
  getSelectedModel,
  clearPromptArea,
  getTopicKeyValue,
  clearTopicKeyInput,
  setRefreshModelsLoading,
  updateRefreshModelsTooltip
} from './elements.js';
import { addToChatHistory } from '../messages/history.js';
import { initializeNewChat, joinExistingChat } from '../network/hyperswarm.js';
import { setChatMode, isCollaborativeMode, isSessionHost } from '../session/modes.js';
import { fetchAvailableModels, requestModelsFromHost } from '../llm/models.js';
import { ask } from '../llm/ollama.js';

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
  
  // Chat mode select change handler
  if (chatModeSelect) {
    chatModeSelect.addEventListener('change', handleChatModeChange);
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
 * Handle chat mode select change
 */
function handleChatModeChange() {
  const newMode = chatModeSelect.value === 'collaborative';
  setChatMode(newMode);
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
  handleChatModeChange,
  handleRefreshModelsClick
};
