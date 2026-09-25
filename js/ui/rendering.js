/**
 * UI Rendering module.
 *
 * Views subscribe to the message store and client state; nothing here calls
 * back into the store's mutators, so there is no render/mutate cycle.
 */
import {
  chatMessagesEl,
  activeUsersEl,
  modelSelect,
  chatModeSelect,
  setChatModeSelectValue,
  setChatModeSelectEnabled
} from './elements.js';
import { renderAssistantContent } from '../messages/formatting.js';
import { formatModelName } from '../llm/models.js';
import { getHistory, subscribe as subscribeStore } from '../messages/store.js';
import { getState, subscribe as subscribeState } from '../session/client-state.js';
import {
  ensureChatLog,
  getEphemeralAnchor,
  getHistoryMessageId,
  isNearBottom,
  setHistoryMessageId,
  scrollToBottom
} from './ephemeral.js';

const PEER_COLOR_CLASSES = ['peer-color-1', 'peer-color-2', 'peer-color-3', 'peer-color-4', 'peer-color-5'];

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
      element: visibleMessage.classList.contains('message-ephemeral') ? visibleMessage : null,
      historyId: getHistoryMessageId(visibleMessage),
      offset: visibleMessage.getBoundingClientRect().top - containerRect.top
    }
  };
}

function restoreScrollPosition(chatLog, position) {
  if (position.shouldFollow) {
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

  chatLog.scrollTop = position.scrollTop + (chatLog.scrollHeight - position.scrollHeight);
}

/**
 * Create a DOM element for one history message.
 * @param {Object} message
 * @returns {HTMLElement}
 */
function createMessageElement(message) {
  const messageEl = document.createElement('div');
  messageEl.classList.add('message');
  setHistoryMessageId(messageEl, message.id);

  const messageContent = message.content || '';

  switch (message.type) {
    case 'user': {
      messageEl.classList.add('user-message');
      const userHeader = document.createElement('div');
      userHeader.classList.add('message-header');
      userHeader.textContent = message.fromPeer || 'You';
      messageEl.appendChild(userHeader);
      const userBody = document.createElement('div');
      userBody.classList.add('message-body');
      userBody.textContent = messageContent;
      messageEl.appendChild(userBody);
      break;
    }
    case 'assistant': {
      messageEl.classList.add('assistant-message');
      const assistantHeader = document.createElement('div');
      assistantHeader.classList.add('message-header');
      assistantHeader.textContent = message.modelName || (message.fromPeer ? `${message.fromPeer}'s AI` : 'AI Assistant');
      messageEl.appendChild(assistantHeader);
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

  if (message.requestId) messageEl.setAttribute('data-request-id', message.requestId);
  return messageEl;
}

/**
 * Reconcile the chat log with the current message store.
 */
function updateChatDisplay() {
  if (!chatMessagesEl) return;

  ensureChatLog(chatMessagesEl);
  const scrollPosition = captureScrollPosition(chatMessagesEl);
  const chatHistory = getHistory();

  const ephemeralMessages = Array.from(chatMessagesEl.children)
    .filter((child) => child.classList.contains('message-ephemeral'));

  for (const child of Array.from(chatMessagesEl.children)) {
    if (child.classList.contains('message') && !child.classList.contains('message-ephemeral')) child.remove();
  }

  let lastMessageType = null;
  let lastMessageContent = null;
  const renderedMessages = [];
  for (const message of chatHistory) {
    if (message.type === 'assistant' && lastMessageType === 'assistant' && message.content === lastMessageContent) continue;
    renderedMessages.push(message);
    lastMessageType = message.type;
    lastMessageContent = message.content;
  }

  const retainedBoundaries = new Map(renderedMessages.map((message, index) => [message.id, index + 1]));
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
 * Render the active user chips from client state.
 */
function updateActiveUsersDisplay() {
  if (!activeUsersEl) return;
  activeUsersEl.innerHTML = '';

  const youChip = document.createElement('div');
  youChip.className = 'user-chip';
  youChip.style.backgroundColor = '#4A6BBF';
  youChip.textContent = 'You';
  activeUsersEl.appendChild(youChip);

  const peers = getState().peers;
  peers.forEach((peer, index) => {
    const peerChip = document.createElement('div');
    peerChip.className = 'user-chip';
    peerChip.classList.add(PEER_COLOR_CLASSES[index % PEER_COLOR_CLASSES.length]);
    peerChip.textContent = peer.displayName;
    activeUsersEl.appendChild(peerChip);
  });
}

function updateModelSelectFromState() {
  if (!modelSelect) return;
  const { models } = getState();
  const current = modelSelect.value;
  modelSelect.innerHTML = '';
  for (const model of models) {
    const id = model.id || model.name;
    const option = document.createElement('option');
    option.value = id;
    option.textContent = formatModelName(model.name || model.id);
    modelSelect.appendChild(option);
  }
  if (current && Array.from(modelSelect.options).some((option) => option.value === current)) {
    modelSelect.value = current;
  }
}

function updateModeSelectFromState() {
  if (!chatModeSelect) return;
  const { collaborative, role } = getState();
  setChatModeSelectValue(collaborative);
  setChatModeSelectEnabled(role === 'host');
}

function renderClientState() {
  updateActiveUsersDisplay();
  updateModelSelectFromState();
  updateModeSelectFromState();
}

let initialized = false;
/**
 * Subscribe views to the store and client state. Idempotent.
 */
function initializeRendering() {
  if (initialized) return;
  initialized = true;
  subscribeStore(() => updateChatDisplay());
  subscribeState(() => renderClientState());
  updateChatDisplay();
  renderClientState();
}

export {
  PEER_COLOR_CLASSES,
  createMessageElement,
  updateChatDisplay,
  updateActiveUsersDisplay,
  initializeRendering
};