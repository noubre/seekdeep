import test from 'brittle';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { dispatchSlashTag, listSlashTags, helpServices } from './helpers/slash-runtime.js';
import { initializeComposerDiscovery } from '../js/ui/composer-discovery.js';

import { addMessage, clear, getHistory } from '../js/messages/store.js';
import { routePromptSubmission } from '../js/ui/submit-routing.js';
import { createEphemeralRenderer } from '../js/ui/ephemeral.js';
import { initializeElements } from '../js/ui/elements.js';
import { updateChatDisplay, initializeRendering } from '../js/ui/rendering.js';

function createDom() {
  return new JSDOM('<!doctype html><div id="chat-messages"></div>', {
    runScripts: 'dangerously'
  });
}

function installDom(dom) {
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.requestAnimationFrame = (callback) => {
    callback();
    return 1;
  };
  initializeElements();
  clear();
  initializeRendering();
}

test('composer discovers current and upcoming slash commands accessibly', async function (t) {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const dom = new JSDOM(html);
  const { document } = dom.window;
  const form = document.querySelector('form');
  const prompt = document.querySelector('textarea[name="prompt"]');
  const helpButton = document.getElementById('slash-help-button');
  const hint = document.getElementById('slash-command-hint');
  let submitCount = 0;

  clear();
  const historyLength = getHistory().length;
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    submitCount += 1;
  });
  initializeComposerDiscovery(document, { listSlash: () => listSlashTags() });
  await new Promise((resolve) => setTimeout(resolve, 0));

  t.ok(helpButton, 'composer has a slash help control');
  t.is(helpButton.type, 'button', 'help control cannot submit the form');
  t.is(helpButton.getAttribute('aria-label'), 'Insert /p2p help into the message prompt');
  t.ok(hint, 'composer has a persistent slash command hint');
  t.ok(prompt.getAttribute('aria-describedby').split(/\s+/).includes(hint.id), 'prompt describes the hint');
  t.ok(hint.textContent.includes('/p2p help'), 'hint exposes the local help command');
  t.ok(hint.textContent.includes('/swarm status'), 'hint advertises the live swarm status command');
  t.ok(hint.textContent.includes('/dht status'), 'hint advertises the live DHT status command');

  for (const command of ['/drive', '/localdrive', '/mirror', '/beam']) {
    t.ok(hint.textContent.includes(command), `hint names upcoming ${command}`);
  }
  t.ok(hint.textContent.toLowerCase().includes('upcoming'), 'resource commands are explicitly upcoming');
  t.absent(/(?:active|available|ready|supported)[^.]*\/(?:drive|localdrive|mirror|beam)/i.test(hint.textContent), 'hint does not claim resource placeholders work');

  prompt.value = 'unsent draft';
  helpButton.click();

  t.is(prompt.value, '/p2p help', 'click fills the help command without running it');
  t.is(document.activeElement, prompt, 'click returns focus to the prompt');
  t.is(submitCount, 0, 'click does not dispatch the form');
  t.is(getHistory().length, historyLength, 'click does not write chat or LLM history');
});

test('slash submission renders locally without model, history, or service effects', async function (t) {
  const dom = createDom();
  const chatMessagesEl = dom.window.document.getElementById('chat-messages');
  const emitEphemeral = createEphemeralRenderer(chatMessagesEl);
  const calls = { model: 0, ask: 0 };
  const historyLength = getHistory().length;

  const result = await routePromptSubmission('/p2p help', {
    dispatchSlash: (text) => dispatchSlashTag(text, { emitEphemeral }, helpServices()),
    getSelectedModel() {
      calls.model += 1;
      return 'must-not-be-read';
    },
    ask() {
      calls.ask += 1;
      throw new Error('must not call ask');
    }
  });

  t.is(result, 'slash');
  t.alike(calls, { model: 0, ask: 0 }, 'slash bypasses model selection and ask');
  t.is(getHistory().length, historyLength, 'slash output is absent from chat history');

  const output = chatMessagesEl.querySelector('.message-ephemeral');
  t.ok(output, 'ephemeral output is appended to the chat DOM');
  t.ok(output.textContent.includes('SeekDeep slash commands'));
  t.is(output.dataset.command, 'p2p');
  t.is(output.dataset.historyAnchor, undefined, 'history identity is not exposed in DOM metadata');
  t.ok(output.classList.contains('ephemeral-help'));
});

test('ephemeral renderer treats command output as inert text', function (t) {
  const dom = createDom();
  const chatMessagesEl = dom.window.document.getElementById('chat-messages');
  const emitEphemeral = createEphemeralRenderer(chatMessagesEl);
  const markup = '<script>window.__slashExecuted = true</script><img src=x onerror="window.__slashExecuted = true">';

  emitEphemeral(markup, {
    kind: 'slash-error injected-class',
    command: 'drive" onclick="window.__slashExecuted=true'
  });

  const output = chatMessagesEl.querySelector('.message-ephemeral');
  t.is(output.querySelector('script'), null);
  t.is(output.querySelector('img'), null);
  t.ok(output.textContent.includes(markup), 'markup is displayed literally');
  t.is(dom.window.__slashExecuted, undefined, 'script and event markup never execute');
  t.is(output.dataset.command, undefined, 'unsafe command metadata is omitted');
  t.ok(output.classList.contains('ephemeral-default'), 'unrecognized kind maps to a fixed safe class');
  t.absent(output.classList.contains('injected-class'));
});

test('normal prompt routes to the LLM exactly once', async function (t) {
  const calls = [];

  const result = await routePromptSubmission('ordinary question', {
    dispatchSlash: async () => false,
    getSelectedModel() {
      calls.push(['model']);
      return 'local-model';
    },
    async ask(model, prompt) {
      calls.push(['ask', model, prompt]);
    }
  });

  t.is(result, 'llm');
  t.alike(calls, [
    ['model'],
    ['ask', 'local-model', 'ordinary question']
  ]);
});

test('updateChatDisplay preserves slash chronology and its persistent live log', async function (t) {
  const dom = createDom();
  installDom(dom);
  const chatMessagesEl = dom.window.document.getElementById('chat-messages');
  const emitEphemeral = createEphemeralRenderer(chatMessagesEl);
  const liveLog = chatMessagesEl;

  await addMessage({ type: 'user', content: 'before slash' });
  const firstSlash = emitEphemeral('first local output', { kind: 'slash-help', command: 'p2p' });
  const secondSlash = emitEphemeral('second local output', { kind: 'slash-placeholder', command: 'dht' });
  const historyLengthAfterSlashes = getHistory().length;
  await addMessage({ type: 'user', content: 'after slash' });
  const streamingMessage = {
    type: 'assistant',
    content: 'stream start',
    rawContent: 'stream start',
    requestId: 'streaming-after-slash'
  };
  await addMessage(streamingMessage);
  streamingMessage.content = 'stream complete';
  streamingMessage.rawContent = 'stream complete';
  updateChatDisplay();
  updateChatDisplay(true);

  const messages = Array.from(chatMessagesEl.querySelectorAll(':scope > .message'));
  t.alike(messages.map((node) => node.textContent), [
    'Youbefore slash',
    'Local /p2pfirst local output',
    'Local /dhtsecond local output',
    'Youafter slash',
    'AI Assistantstream complete'
  ], 'local results retain their DOM position through streaming and full renders');
  t.is(messages[1], firstSlash, 'first local result keeps its node identity');
  t.is(messages[2], secondSlash, 'second local result keeps its node identity');
  t.is(chatMessagesEl, liveLog, 'the live region keeps its identity');
  // index.html owns the live-region semantics now; the renderer must not rewrite them.
  const staticLog = new JSDOM(readFileSync(new URL('../index.html', import.meta.url), 'utf8'))
    .window.document.getElementById('chat-messages');
  t.is(staticLog.getAttribute('role'), 'log', 'app markup declares the log role');
  t.is(staticLog.getAttribute('aria-live'), 'polite', 'app markup declares politeness');
  t.is(staticLog.getAttribute('aria-relevant'), 'additions text', 'app markup declares relevant mutations');
  t.is(liveLog.getAttribute('role'), null, 'the renderer never rewrites the live-region attributes');
  t.ok(liveLog.isConnected, 'the live region remains attached');
  t.is(historyLengthAfterSlashes, 1, 'slash results never enter history');
  t.is(getHistory().length, 3, 'only normal messages enter history');

  clear();
});

test('ephemeral chronology survives history retention truncation', async function (t) {
  const dom = createDom();
  installDom(dom);
  const chatMessagesEl = dom.window.document.getElementById('chat-messages');
  const emitEphemeral = createEphemeralRenderer(chatMessagesEl);

  for (let index = 1; index <= 100; index += 1) {
    await addMessage({ type: 'user', content: `normal ${index}` });
  }

  const slash = emitEphemeral('local at retention edge', {
    kind: 'slash-help',
    command: 'p2p'
  });
  await addMessage({ type: 'user', content: 'normal 101' });
  updateChatDisplay(true);

  const messages = Array.from(chatMessagesEl.querySelectorAll(':scope > .message'));
  const slashIndex = messages.indexOf(slash);
  const lastOldIndex = messages.findIndex((node) => node.textContent === 'Younormal 100');
  const newIndex = messages.findIndex((node) => node.textContent === 'Younormal 101');
  t.is(getHistory().length, 100, 'history retains its configured maximum');
  t.ok(lastOldIndex < slashIndex, 'slash remains after its retained predecessor');
  t.ok(slashIndex < newIndex, 'slash remains before the message that caused truncation');
  t.is(messages[slashIndex], slash, 'slash DOM node identity survives the full render');

  clear();
});

test('ephemeral chronology stays before retained successors after its anchor is evicted', async function (t) {
  const dom = createDom();
  installDom(dom);
  const chatMessagesEl = dom.window.document.getElementById('chat-messages');
  const emitEphemeral = createEphemeralRenderer(chatMessagesEl);

  await addMessage({ type: 'user', content: 'eventual evicted anchor' });
  const firstSlash = emitEphemeral('first local output', { command: 'p2p' });
  const secondSlash = emitEphemeral('second local output', { command: 'dht' });
  for (let index = 1; index <= 100; index += 1) {
    await addMessage({ type: 'user', content: `later ${index}` });
  }
  updateChatDisplay(true);

  const messages = Array.from(chatMessagesEl.querySelectorAll(':scope > .message'));
  t.is(messages[0], firstSlash, 'first local output precedes all retained later history');
  t.is(messages[1], secondSlash, 'multiple local outputs preserve their emission order');
  t.is(messages[2].textContent, 'Youlater 1', 'oldest retained successor follows local output');
  t.is(messages.at(-1).textContent, 'Youlater 100');

  clear();
});

test('multiple ephemeral outputs from empty history precede the first normal message', async function (t) {
  const dom = createDom();
  installDom(dom);
  const chatMessagesEl = dom.window.document.getElementById('chat-messages');
  const emitEphemeral = createEphemeralRenderer(chatMessagesEl);

  const firstSlash = emitEphemeral('first empty-history output', { command: 'p2p' });
  const secondSlash = emitEphemeral('second empty-history output', { command: 'dht' });
  await addMessage({ type: 'user', content: 'first normal message' });
  updateChatDisplay(true);

  const messages = Array.from(chatMessagesEl.querySelectorAll(':scope > .message'));
  t.is(messages.length, 3);
  t.is(messages[0], firstSlash, 'first local output remains first');
  t.is(messages[1], secondSlash, 'local outputs keep emission order');
  t.is(messages[2].textContent, 'Youfirst normal message');

  clear();
});

test('updateChatDisplay restores a scrolled-up visible message after reconciliation', async function (t) {
  const dom = createDom();
  installDom(dom);
  const chatMessagesEl = dom.window.document.getElementById('chat-messages');
  const messages = [
    { id: 'scroll-1', type: 'user', content: 'one' },
    { id: 'scroll-2', type: 'user', content: 'two' },
    { id: 'scroll-3', type: 'assistant', content: 'stream start', rawContent: 'stream start', requestId: 'scroll-stream' },
    { id: 'scroll-4', type: 'user', content: 'four' }
  ];

  for (const message of messages) await addMessage(message);

  let scrollTop = 150;
  Object.defineProperties(chatMessagesEl, {
    clientHeight: { configurable: true, value: 100 },
    scrollHeight: {
      configurable: true,
      get: () => chatMessagesEl.children.length * 100
    },
    scrollTop: {
      configurable: true,
      get: () => scrollTop,
      set: (value) => { scrollTop = value; }
    }
  });

  dom.window.HTMLElement.prototype.getBoundingClientRect = function () {
    if (this === chatMessagesEl) {
      return { top: 0, bottom: 100, height: 100, left: 0, right: 0, width: 0 };
    }
    const index = Array.from(chatMessagesEl.children).indexOf(this);
    const top = (index * 100) - scrollTop;
    return { top, bottom: top + 100, height: 100, left: 0, right: 0, width: 0 };
  };

  for (const node of Array.from(chatMessagesEl.children)) {
    const remove = node.remove.bind(node);
    node.remove = () => {
      scrollTop = 0; // Browsers clamp when the scrollable children disappear.
      remove();
    };
  }

  messages[2].content = 'stream complete';
  messages[2].rawContent = 'stream complete';
  updateChatDisplay();

  const visibleAnchor = Array.from(chatMessagesEl.children)
    .find((node) => node.textContent === 'Youtwo');
  t.is(scrollTop, 150, 'stream reconciliation restores the prior viewport');
  t.is(visibleAnchor.getBoundingClientRect().top, -50, 'the same visible message keeps its offset');

  scrollTop = 260;
  updateChatDisplay(true);
  t.is(scrollTop, 400, 'a reader near the bottom follows a full reconciliation');

  clear();
});

test('ephemeral appends respect the near-bottom scroll policy', function (t) {
  const dom = createDom();
  const chatMessagesEl = dom.window.document.getElementById('chat-messages');
  const emitEphemeral = createEphemeralRenderer(chatMessagesEl);
  let scrollTop = 100;

  Object.defineProperties(chatMessagesEl, {
    clientHeight: { configurable: true, value: 100 },
    scrollHeight: { configurable: true, value: 500 },
    scrollTop: {
      configurable: true,
      get: () => scrollTop,
      set: (value) => { scrollTop = value; }
    }
  });
  globalThis.requestAnimationFrame = (callback) => {
    callback();
    return 1;
  };

  emitEphemeral('do not jump', { command: 'p2p' });
  t.is(scrollTop, 100, 'a reader who scrolled up is not forced to the bottom');

  scrollTop = 360;
  emitEphemeral('follow output', { command: 'p2p' });
  t.is(scrollTop, 500, 'a reader near the bottom follows new local output');
});
