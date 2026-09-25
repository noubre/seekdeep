/**
 * UI Rendering module
 * Contains functions for rendering messages and updating the UI
 */
import { chatMessagesEl, activeUsersEl } from './elements.js';
import { getActivePeers } from '../session/peers.js';
import { renderAssistantContent } from '../messages/formatting.js';
import { getChatHistory } from '../messages/history.js';
import { PEER_COLORS } from '../session/peers.js';
import {
  ensureChatLog,
  getEphemeralAnchor,
  getHistoryMessageId,
  isNearBottom,
  setHistoryMessageId,
  scrollToBottom
} from './ephemeral.js';

function captureScrollPosition(chatLog) {
  const containerRect = chatLog.getBoundingClientRect();
  const visibleMessage = Array.from(chatLog.children).find((child) => {
    if (!child.classList.contains('message')) return false;
    const rect = child.getBoundingClientRect();
    return rect.bottom > containerRect.top && rect.top < containerRect.bottom;
  });

  return {
    shouldFollow: isNearBottom(chatLog),
    scrollTop: chatLog.scrollTop,
    scrollHeight: chatLog.scrollHeight,
    anchor: visibleMessage && {
      element: visibleMessage.classList.contains('message-ephemeral')
        ? visibleMessage
        : null,
      historyId: getHistoryMessageId(visibleMessage),
      offset: visibleMessage.getBoundingClientRect().top - containerRect.top
    }
  };
}

function restoreScrollPosition(chatLog, position) {
  if (position.shouldFollow) {
    // Restore immediately so another streaming update in the same frame still
    // sees the reader at the bottom, then repeat after layout settles.
    chatLog.scrollTop = chatLog.scrollHeight;
    scrollToBottom(chatLog);
    return;
  }

  let anchorEl = position.anchor?.element;
  if (anchorEl?.parentElement !== chatLog && position.anchor?.historyId) {
    anchorEl = Array.from(chatLog.children).find((child) => (
      getHistoryMessageId(child) === position.anchor.historyId
    ));
  }

  if (anchorEl?.parentElement === chatLog) {
    const containerTop = chatLog.getBoundingClientRect().top;
    const currentOffset = anchorEl.getBoundingClientRect().top - containerTop;
    chatLog.scrollTop += currentOffset - position.anchor.offset;
    return;
  }

  chatLog.scrollTop = position.scrollTop
    + (chatLog.scrollHeight - position.scrollHeight);
}

/**
 * Create a message element to add to the chat
 * @param {Object} message - The message object to render
 * @returns {HTMLElement} The created message element
 */
function createMessageElement(message) {
  const messageEl = document.createElement('div');
  messageEl.classList.add('message');
  setHistoryMessageId(messageEl, message.id);
  
  console.log("Creating message element for:", message);
  
  const messageContent = message.content || '';
  
  switch (message.type) {
    case 'user': {
      messageEl.classList.add('user-message');
      
      const sender = message.fromPeer || 'You';
      
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
      
      const modelName = message.modelName || (message.fromPeer ? `${message.fromPeer}'s AI` : 'AI Assistant');
      assistantHeader.textContent = modelName;
      
      messageEl.appendChild(assistantHeader);
      
      // Create body with Markdown rendering
      const assistantBody = document.createElement('div');
      assistantBody.classList.add('message-body');
      
      assistantBody.innerHTML = renderAssistantContent(message.rawContent || messageContent);
      
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
    messageEl.setAttribute('data-request-id', message.requestId);
  }
  
  return messageEl;
}

/**
 * Update the chat display from the history
 * @param {boolean} forceFullRender - Force a complete re-render of all messages
 */
function updateChatDisplay(_forceFullRender = false) {
  if (!chatMessagesEl) return;

  ensureChatLog(chatMessagesEl);
  const scrollPosition = captureScrollPosition(chatMessagesEl);
  const chatHistory = getChatHistory();
  console.log(`Length of chat history: ${chatHistory.length}`);

  const ephemeralMessages = Array.from(chatMessagesEl.children)
    .filter((child) => child.classList.contains('message-ephemeral'));

  // Reconcile only persisted message nodes. Local results stay attached at
  // their fixed history boundaries, including during full and stream renders.
  for (const child of Array.from(chatMessagesEl.children)) {
    if (child.classList.contains('message')
        && !child.classList.contains('message-ephemeral')) {
      child.remove();
    }
  }

  let lastMessageType = null;
  let lastMessageContent = null;
  const renderedMessages = [];

  for (const message of chatHistory) {
    if (message.type === 'assistant'
        && lastMessageType === 'assistant'
        && message.content === lastMessageContent) {
      console.log(`Skipping duplicate consecutive message in display: ${message.content}`);
      continue;
    }

    renderedMessages.push(message);
    lastMessageType = message.type;
    lastMessageContent = message.content;
  }

  const retainedBoundaries = new Map(renderedMessages.map((message, index) => (
    [message.id, index + 1]
  )));
  let renderedIndex = 0;

  for (const message of renderedMessages) {
    const messageEl = createMessageElement(message);
    const nextEphemeral = ephemeralMessages.find((ephemeral) => {
      const anchor = getEphemeralAnchor(ephemeral);
      const boundary = retainedBoundaries.get(anchor?.afterId) || 0;
      return boundary > renderedIndex;
    });

    chatMessagesEl.insertBefore(messageEl, nextEphemeral || null);
    renderedIndex += 1;
  }

  restoreScrollPosition(chatMessagesEl, scrollPosition);
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
