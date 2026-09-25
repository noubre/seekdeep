/**
 * Renderer entry point. The renderer is a view/controller only: all P2P and
 * provider work happens in the Bare worker; this module boots the UI, the chat
 * client, and fans worker events into the message store and client state.
 */
import * as ui from './ui/elements.js';
import * as events from './ui/events.js';
import { initializeComposerDiscovery } from './ui/composer-discovery.js';
import * as historyBrowser from './ui/history-browser.js';
import { initializeChatClient } from './chat-client.js';
import { clientState } from './session/client-state.js';
import { initializeRendering } from './ui/rendering.js';
import { addMessage, notify, findLastMessageByRequestId } from './messages/store.js';

function applyResponse(event) {
  const { requestId, chunk, done } = event;
  let message = findLastMessageByRequestId(requestId, 'assistant');
  if (!message) {
    message = addMessage({ type: 'assistant', content: '', rawContent: '', requestId });
  }
  if (chunk) {
    message.rawContent = (message.rawContent || '') + chunk;
    message.content = message.rawContent;
  }
  if (done) message.isComplete = true;
  notify();
}

function initializeApp() {
  console.log('Initializing SeekDeep application...');

  ui.initializeElements();
  ui.initializeCopyButton();
  initializeComposerDiscovery();
  historyBrowser.initializeHistoryBrowser();
  initializeRendering();

  const chatClient = initializeChatClient();
  globalThis.seekdeep = { chatClient, clientState };

  chatClient.onEvent((event) => {
    clientState.applyEvent(event);
    if (event.type === 'message' && event.message) {
      addMessage(event.message);
    } else if (event.type === 'response') {
      applyResponse(event);
    }
  });

  events.setupEventListeners({ chatClient, clientState });

  chatClient.api.create().catch((error) => {
    console.warn('Failed to create chat session:', error.message);
  });

  console.log('SeekDeep application initialized successfully');
}

document.addEventListener('DOMContentLoaded', initializeApp);

export { initializeApp, applyResponse };