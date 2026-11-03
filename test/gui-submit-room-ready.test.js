import test from 'brittle';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { initializeElements } from '../js/ui/elements.js';
import { setupEventListeners } from '../js/ui/events.js';
import { clear } from '../js/messages/store.js';

function mountComposer(promptText) {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const dom = new JSDOM(html, { url: 'http://seekdeep.local/' });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  initializeElements();
  clear();
  const form = dom.window.document.querySelector('form');
  const prompt = dom.window.document.querySelector('textarea[name="prompt"]');
  prompt.value = promptText;
  return { dom, form, prompt };
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

const nextTick = () => new Promise((resolve) => setTimeout(resolve, 0));

test('a submit typed before the room exists waits for it instead of racing chat.send', async function (t) {
  const { form, prompt } = mountComposer('/p2p help');
  const room = deferred();
  let slashCount = 0;

  setupEventListeners({
    chatClient: {
      dispatchSlash() { slashCount += 1; return Promise.resolve(true); },
      api: {}
    },
    roomReady: room.promise
  });

  form.dispatchEvent(new globalThis.window.Event('submit'));
  await nextTick();
  t.is(slashCount, 0, 'the prompt is held while the room is still being created');

  room.resolve({ ok: true });
  await nextTick();
  t.is(slashCount, 1, 'the held prompt is routed exactly once once the room is ready');
  t.is(prompt.value, '', 'the accepted prompt is consumed');
});

test('a submit whose room failed keeps the draft and never dispatches', async function (t) {
  const { form, prompt } = mountComposer('keep me');
  const room = deferred();
  let slashCount = 0;

  setupEventListeners({
    chatClient: {
      dispatchSlash() { slashCount += 1; return Promise.resolve(false); },
      api: {}
    },
    roomReady: room.promise
  });

  form.dispatchEvent(new globalThis.window.Event('submit'));
  await nextTick();
  room.resolve({ ok: false, phase: 'create' });
  await nextTick();

  t.is(slashCount, 0, 'a failed room never reaches the slash dispatcher');
  t.is(prompt.value, 'keep me', 'the draft is kept for a retry');
});
