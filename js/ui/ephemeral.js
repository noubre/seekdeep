const KIND_CLASSES = Object.freeze({
  'slash-help': 'ephemeral-help',
  'slash-error': 'ephemeral-error',
  'slash-placeholder': 'ephemeral-placeholder'
});
const SAFE_COMMAND = /^[a-z0-9][a-z0-9-]{0,63}$/;
const SCROLL_THRESHOLD = 50;
const historyMessageIds = new WeakMap();
const ephemeralAnchors = new WeakMap();

function ensureChatLog(chatMessagesEl) {
  chatMessagesEl.setAttribute('role', 'log');
  chatMessagesEl.setAttribute('aria-live', 'polite');
  chatMessagesEl.setAttribute('aria-relevant', 'additions text');
}

function isNearBottom(chatMessagesEl) {
  return chatMessagesEl.scrollTop + chatMessagesEl.clientHeight
    >= chatMessagesEl.scrollHeight - SCROLL_THRESHOLD;
}

function scrollToBottom(chatMessagesEl) {
  const view = chatMessagesEl.ownerDocument.defaultView;
  const scroll = () => {
    chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
  };

  if (typeof globalThis.requestAnimationFrame === 'function') {
    globalThis.requestAnimationFrame(scroll);
  } else if (typeof view?.requestAnimationFrame === 'function') {
    view.requestAnimationFrame(scroll);
  } else {
    scroll();
  }
}

function setHistoryMessageId(messageEl, id) {
  if (typeof id === 'string' && id) historyMessageIds.set(messageEl, id);
}

function getHistoryMessageId(messageEl) {
  return historyMessageIds.get(messageEl) || null;
}

function findLastRenderedHistoryId(chatMessagesEl) {
  const children = Array.from(chatMessagesEl.children);
  for (let index = children.length - 1; index >= 0; index -= 1) {
    const id = getHistoryMessageId(children[index]);
    if (id) return id;
  }
  return null;
}

function getEphemeralAnchor(messageEl) {
  return ephemeralAnchors.get(messageEl) || null;
}

/**
 * Create a text-only renderer scoped to one chat display.
 * Local results are direct children of the persistent chat log. Their anchor
 * is the stable identity of the last rendered history message, held only in
 * ephemeral in-memory state without changing the persisted message schema.
 */
function createEphemeralRenderer(chatMessagesEl) {
  if (!chatMessagesEl || typeof chatMessagesEl.appendChild !== 'function') {
    throw new TypeError('Ephemeral rendering requires a chat messages element');
  }

  ensureChatLog(chatMessagesEl);

  return function emitEphemeral(content, metadata = {}) {
    const shouldFollow = isNearBottom(chatMessagesEl);
    const safeMetadata = metadata && typeof metadata === 'object' ? metadata : {};
    const messageEl = chatMessagesEl.ownerDocument.createElement('div');
    const kindClass = KIND_CLASSES[safeMetadata.kind] || 'ephemeral-default';
    messageEl.classList.add('message', 'message-ephemeral', kindClass);
    ephemeralAnchors.set(messageEl, {
      afterId: findLastRenderedHistoryId(chatMessagesEl)
    });

    if (typeof safeMetadata.command === 'string' && SAFE_COMMAND.test(safeMetadata.command)) {
      messageEl.dataset.command = safeMetadata.command;
    }

    const labelEl = chatMessagesEl.ownerDocument.createElement('div');
    labelEl.classList.add('ephemeral-label');
    labelEl.textContent = messageEl.dataset.command
      ? `Local /${messageEl.dataset.command}`
      : 'Local command';

    const bodyEl = chatMessagesEl.ownerDocument.createElement('div');
    bodyEl.classList.add('ephemeral-body');
    bodyEl.textContent = String(content);

    messageEl.appendChild(labelEl);
    messageEl.appendChild(bodyEl);
    chatMessagesEl.appendChild(messageEl);

    if (shouldFollow) scrollToBottom(chatMessagesEl);
    return messageEl;
  };
}

export {
  createEphemeralRenderer,
  ensureChatLog,
  getEphemeralAnchor,
  getHistoryMessageId,
  isNearBottom,
  setHistoryMessageId,
  scrollToBottom
};
