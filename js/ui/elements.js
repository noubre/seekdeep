/**
 * UI Elements module
 * Contains references to DOM elements and basic manipulation functions
 */

// DOM element references
let form;
let chatMessagesEl;
let activeUsersEl;
let promptArea;
let topicKeyInput;
let joinButton;
let chatModeSelect;
let modelSelect;
let refreshModelsButton;
let currentTopicEl;
let copyTopicButton;

/**
 * Initialize UI element references
 */
function initializeElements() {
  form = document.querySelector('form');
  chatMessagesEl = document.getElementById('chat-messages');
  activeUsersEl = document.getElementById('active-users');
  promptArea = document.querySelector('textarea[name="prompt"]');
  topicKeyInput = document.getElementById('topic-key');
  joinButton = document.getElementById('join-button');
  chatModeSelect = document.getElementById('chat-mode');
  modelSelect = document.getElementById('model-select');
  refreshModelsButton = document.getElementById('refresh-models');
  currentTopicEl = document.getElementById('current-topic');
  copyTopicButton = document.getElementById('copy-topic');
}

/**
 * Clear the prompt area
 */
function clearPromptArea() {
  if (promptArea) {
    promptArea.value = '';
  }
}

/**
 * Get the value of the prompt area
 * @returns {string} The current value of the prompt area
 */
function getPromptValue() {
  return promptArea ? promptArea.value.trim() : '';
}

/**
 * Get the selected model from the model select dropdown
 * @returns {string} The ID of the selected model
 */
function getSelectedModel() {
  return modelSelect ? modelSelect.value : '';
}

/**
 * Get the current chat mode from the chat mode select dropdown
 * @returns {boolean} True if collaborative mode is selected, false for private mode
 */
function isCollaborativeModeSelected() {
  return chatModeSelect ? chatModeSelect.value === 'collaborative' : false;
}

/**
 * Set the chat mode select dropdown to a specific value
 * @param {boolean} isCollaborative - Whether to set to collaborative mode (true) or private mode (false)
 */
function setChatModeSelectValue(isCollaborative) {
  if (chatModeSelect) {
    chatModeSelect.value = isCollaborative ? 'collaborative' : 'private';
  }
}

/**
 * Enable or disable the chat mode select dropdown
 * @param {boolean} enabled - Whether the dropdown should be enabled
 */
function setChatModeSelectEnabled(enabled) {
  if (chatModeSelect) {
    chatModeSelect.disabled = !enabled;
  }
}

/**
 * Get the topic key from the input field
 * @returns {string} The current value of the topic key input
 */
function getTopicKeyValue() {
  return topicKeyInput ? topicKeyInput.value.trim() : '';
}

/**
 * Clear the topic key input field
 */
function clearTopicKeyInput() {
  if (topicKeyInput) {
    topicKeyInput.value = '';
  }
}

/**
 * Show or hide the refresh models button loading state
 * @param {boolean} isLoading - Whether the button should show loading state
 */
function setRefreshModelsLoading(isLoading) {
  if (refreshModelsButton) {
    if (isLoading) {
      refreshModelsButton.classList.add('refreshing');
      refreshModelsButton.disabled = true;
    } else {
      refreshModelsButton.classList.remove('refreshing');
      refreshModelsButton.disabled = false;
    }
  }
}

/**
 * Update the refresh models button tooltip with a timestamp
 * @param {string} message - The message to show in the tooltip
 */
function updateRefreshModelsTooltip(message) {
  if (refreshModelsButton) {
    refreshModelsButton.setAttribute('title', message);
  }
}

/**
 * Update the displayed topic key
 * @param {string|null} topicKey - The topic key to display, or null to clear
 */
function updateTopicDisplay(topicKey) {
  if (currentTopicEl) {
    currentTopicEl.textContent = topicKey || '';
    currentTopicEl.parentElement.style.display = topicKey ? 'flex' : 'none';
  }
}

/**
 * Initialize the copy topic button functionality
 */
function initializeCopyButton() {
  if (copyTopicButton) {
    copyTopicButton.addEventListener('click', async () => {
      const topicKey = currentTopicEl.textContent;
      if (topicKey) {
        try {
          await navigator.clipboard.writeText(topicKey);
          const originalTitle = copyTopicButton.getAttribute('title');
          copyTopicButton.setAttribute('title', 'Copied!');
          setTimeout(() => {
            copyTopicButton.setAttribute('title', originalTitle);
          }, 2000);
        } catch (err) {
          console.error('Failed to copy topic key:', err);
        }
      }
    });
  }
}

// Export functions and elements
export {
  // Functions
  initializeElements,
  clearPromptArea,
  getPromptValue,
  getSelectedModel,
  isCollaborativeModeSelected,
  setChatModeSelectValue,
  setChatModeSelectEnabled,
  getTopicKeyValue,
  clearTopicKeyInput,
  setRefreshModelsLoading,
  updateRefreshModelsTooltip,
  updateTopicDisplay,
  initializeCopyButton,
  
  // Element references (for modules that need direct access)
  form,
  chatMessagesEl,
  activeUsersEl,
  promptArea,
  topicKeyInput,
  joinButton,
  chatModeSelect,
  modelSelect,
  refreshModelsButton,
  currentTopicEl,
  copyTopicButton
};
