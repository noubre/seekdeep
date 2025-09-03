/**
 * UI Rendering module
 * Contains functions for rendering messages and updating the UI
 */
import { chatMessagesEl, activeUsersEl } from './elements.js';
import { getActivePeers } from '../session/peers.js';
import { formatThinkingContent, containsMarkdown, renderMarkdown } from '../messages/formatting.js';
import { getChatHistory } from '../messages/history.js';
import { PEER_COLORS } from '../session/peers.js';

/**
 * Create a message element to add to the chat
 * @param {Object} message - The message object to render
 * @returns {HTMLElement} The created message element
 */
function createMessageElement(message) {
  const messageEl = document.createElement('div');
  messageEl.classList.add('message');
  
  console.log("Creating message element for:", message);
  
  // We'll now process the content differently based on message type
  let messageContent = '';
  
  if (message.type === 'assistant') {
    // For assistant messages, always use the raw content if available
    // This ensures thinking content is properly rendered
    if (message.rawContent) {
      // Process the raw content to properly format thinking tags
      messageContent = formatThinkingContent(message.rawContent);
    } else {
      // If no raw content, fall back to regular content
      messageContent = message.content || '';
    }
  } else {
    // For non-assistant messages, just use the content
    messageContent = message.content || '';
  }
  
  switch (message.type) {
    case 'user': {
      messageEl.classList.add('user-message');
      
      // In private mode, all user messages are from "You"
      const sender = 'You';
      
      // Create header
      const userHeader = document.createElement('div');
      userHeader.classList.add('message-header');
      userHeader.textContent = sender;
      messageEl.appendChild(userHeader);
      
      // Create body
      const userBody = document.createElement('div');
      userBody.classList.add('message-body');
      userBody.textContent = messageContent;
      messageEl.appendChild(userBody);
      break;
    }
    
    case 'assistant': {
      messageEl.classList.add('assistant-message');
      
      // Create header
      const assistantHeader = document.createElement('div');
      assistantHeader.classList.add('message-header');
      
      // Get model name from the current model
      const modelName = message.modelName || 'AI Assistant';
      assistantHeader.textContent = modelName;
      
      messageEl.appendChild(assistantHeader);
      
      // Create body with Markdown rendering
      const assistantBody = document.createElement('div');
      assistantBody.classList.add('message-body');
      
      // Render Markdown if content seems to contain it
      if (containsMarkdown(messageContent) || messageContent.includes('<div class="thinking-content">')) {
        assistantBody.innerHTML = renderMarkdown(messageContent);
      } else {
        assistantBody.innerHTML = messageContent.replace(/\n/g, '<br>');
      }
      
      messageEl.appendChild(assistantBody);
      break;
    }
    
    case 'system':
      messageEl.classList.add('message-system');
      messageEl.textContent = messageContent;
      break;
      
    case 'thinking':
      messageEl.classList.add('message-thinking');
      messageEl.textContent = messageContent;
      break;
      
    default:
      messageEl.textContent = JSON.stringify(message);
  }
  
  // Store request ID for later reference
  if (message.requestId) {
    messageEl.dataset.requestId = message.requestId;
  }
  
  return messageEl;
}

/**
 * Update the chat display from the history
 */
function updateChatDisplay() {
  if (!chatMessagesEl) return;
  
  // Clear current display
  chatMessagesEl.innerHTML = '';
  
  // Keep track of the last message type to avoid duplicates
  let lastMessageType = null;
  let lastMessageContent = null;
  
  const chatHistory = getChatHistory();
  // console.log(JSON.stringify(chatHistory, null, 2));
  console.log(`Length of chat history: ${chatHistory.length}`)

  for (const message of chatHistory) {
    // Skip duplicate consecutive assistant messages
    // TODO: Fix this
    if (message.type === 'assistant' && lastMessageType === 'assistant' && message.content === lastMessageContent) {
      console.log(`Skipping duplicate consecutive message in display: ${message.content}`);
      continue;
    }
    
    // Create and append message element
    const messageEl = createMessageElement(message);
    chatMessagesEl.appendChild(messageEl);
    
    lastMessageType = message.type;
    lastMessageContent = message.content;
  }
  
  console.log("Before scroll - scrollTop:", chatMessagesEl.scrollTop, "scrollHeight:", chatMessagesEl.scrollHeight);
  // Scroll to the bottom using requestAnimationFrame
  requestAnimationFrame(() => {
    chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
    console.log("After scroll - scrollTop:", chatMessagesEl.scrollTop, "scrollHeight:", chatMessagesEl.scrollHeight);
  });
}

/**
 * Update the active users display in the UI
 */
function updateActiveUsersDisplay() {
  if (!activeUsersEl) return;
  
  // Clear current display
  activeUsersEl.innerHTML = '';
  
  // Add yourself
  const youChip = document.createElement('div');
  youChip.className = 'user-chip';
  youChip.style.backgroundColor = '#4A6BBF';
  youChip.textContent = 'You';
  activeUsersEl.appendChild(youChip);
  
  // Add each peer
  const activePeers = getActivePeers();
  activePeers.forEach(peer => {
    const peerChip = document.createElement('div');
    peerChip.className = 'user-chip';
    // Get the background color from the peer's color class
    const colorClass = document.createElement('div');
    colorClass.className = peer.colorClass;
    document.body.appendChild(colorClass);
    const computedStyle = window.getComputedStyle(colorClass);
    peerChip.style.backgroundColor = computedStyle.backgroundColor;
    document.body.removeChild(colorClass);
    
    peerChip.textContent = peer.displayName;
    activeUsersEl.appendChild(peerChip);
  });
}

// Export functions
export {
  createMessageElement,
  updateChatDisplay,
  updateActiveUsersDisplay
};
