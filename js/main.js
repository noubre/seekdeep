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
import { createInitialRoom } from './ui/startup.js';
import { createEphemeralRenderer } from './ui/ephemeral.js';
import { addMessage, notify } from './messages/store.js';
import { applyAssistantChunk } from './messages/stream.js';

function applyResponse(event) {
  applyAssistantChunk(event);
  notify();
}

function applyBotEvent(event) {
  if (event.kind === 'message') {
    addMessage({ type: 'system', content: `Bot ${event.fromName || event.from || 'peer'}: ${event.text || ''}` });
  } else if (event.kind === 'reply') {
    addMessage({ type: 'system', content: `Bot reply: ${event.text || ''}` });
  }
  notify();
}

function initializeApp() {
  console.log('Initializing SeekDeep application...');

  ui.initializeElements();
  ui.initializeCopyButton();
  historyBrowser.initializeHistoryBrowser();
  initializeRendering();

  const chatClient = initializeChatClient();
  globalThis.seekdeep = { chatClient, clientState };

  initializeComposerDiscovery(document, { listSlash: () => chatClient.listSlash() });

  const emitEphemeral = createEphemeralRenderer(ui.chatMessagesEl);
  chatClient.onHarnessEvent((event) => {
    if (event.type === 'slash') {
      emitEphemeral(event.content, event.metadata);
    } else if (event.type === 'bot') {
      applyBotEvent(event);
    }
  });

  chatClient.onEvent((event) => {
    clientState.applyEvent(event);
    if (event.type === 'message' && event.message) {
      addMessage(event.message);
    } else if (event.type === 'response') {
      applyResponse(event);
    }
  });

  // Wired before the room exists on purpose: submits await `roomReady` instead
  // of racing `chat.send` ahead of `chat.join`.
  const roomReady = createInitialRoom({
    chatClient,
    applyEvent: (event) => clientState.applyEvent(event),
    reportError: (message) => addMessage({ type: 'system', content: message })
  });

  events.setupEventListeners({ chatClient, clientState, roomReady });

  console.log('SeekDeep application initialized successfully');
}

document.addEventListener('DOMContentLoaded', initializeApp);

export { initializeApp, applyResponse };