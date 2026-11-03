import test from 'brittle';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { routePromptSubmission } from '../js/ui/submit-routing.js';
import { initializeElements } from '../js/ui/elements.js';
import { handleFormSubmit } from '../js/ui/events.js';
import { clear, getHistory } from '../js/messages/store.js';

test('composer keeps the draft when no model is selected', async function (t) {
  let clearCount = 0;
  let askCount = 0;

  await t.exception.all(() => routePromptSubmission('keep me', {
    dispatchSlash: async () => false,
    getSelectedModel: () => '',
    clearPromptArea: () => { clearCount += 1; },
    ask: async () => { askCount += 1; }
  }), /select a model/i);

  t.is(clearCount, 0, 'validation failure keeps the draft');
  t.is(askCount, 0, 'validation failure does not call the worker');
});

test('composer clears the draft only after a successful send', async function (t) {
  let clearCount = 0;
  await routePromptSubmission('send me', {
    dispatchSlash: async () => false,
    getSelectedModel: () => 'model-1',
    clearPromptArea: () => { clearCount += 1; },
    ask: async () => ({ requestId: 'request-1' })
  });
  t.is(clearCount, 1);
});

test('composer keeps the draft when the worker rejects the send', async function (t) {
  let clearCount = 0;
  await t.exception.all(() => routePromptSubmission('retry me', {
    dispatchSlash: async () => false,
    getSelectedModel: () => 'model-1',
    clearPromptArea: () => { clearCount += 1; },
    ask: async () => { throw new Error('pipe closed'); }
  }), /pipe closed/);
  t.is(clearCount, 0);
});

function mountComposer(promptText) {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const dom = new JSDOM(html, { url: 'http://seekdeep.local/' });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  initializeElements();
  clear();

  const prompt = dom.window.document.querySelector('textarea[name="prompt"]');
  const model = dom.window.document.getElementById('model-select');
  model.innerHTML = '<option value="model-1">Model One</option>';
  prompt.value = promptText;
  return prompt;
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

const nextTick = () => new Promise((resolve) => setTimeout(resolve, 0));

test('form handler turns a send rejection into a system message', async function (t) {
  const prompt = mountComposer('retry me');

  await handleFormSubmit({ preventDefault() {} }, {
    dispatchSlash: async () => false,
    api: { async send() { throw new Error('pipe closed'); } }
  });

  t.is(prompt.value, 'retry me', 'failed send preserves the draft');
  t.ok(getHistory().some((message) => (
    message.type === 'system' && message.content === 'Could not send message: pipe closed'
  )), 'failure is visible in chat history');
});

test('rapid duplicate submits run a single send and clear once', async function (t) {
  const prompt = mountComposer('send once');
  const send = deferred();
  let sendCount = 0;

  const chatClient = {
    dispatchSlash: async () => false,
    api: {
      send() {
        sendCount += 1;
        return send.promise;
      }
    }
  };

  const first = handleFormSubmit({ preventDefault() {} }, chatClient);
  const second = handleFormSubmit({ preventDefault() {} }, chatClient);
  await nextTick();
  t.is(sendCount, 1, 'the duplicate submit does not fan out a second send');

  send.resolve({ requestId: 'request-1' });
  await Promise.all([first, second]);
  t.is(sendCount, 1, 'completion does not trigger a retry of the duplicate');
  t.is(prompt.value, '', 'the successful send clears the composer exactly once');
});

test('a draft typed while a send is pending survives completion', async function (t) {
  const prompt = mountComposer('submitted draft');
  const send = deferred();

  const pending = handleFormSubmit({ preventDefault() {} }, {
    dispatchSlash: async () => false,
    api: { send: () => send.promise }
  });
  await nextTick();
  prompt.value = 'draft typed while waiting';

  send.resolve({ requestId: 'request-1' });
  await pending;
  t.is(prompt.value, 'draft typed while waiting', 'the newer draft is not cleared');
});

test('slash submissions share the single-submit guard and preserve a newer draft', async function (t) {
  const prompt = mountComposer('/p2p help');
  const slash = deferred();
  let slashCount = 0;

  const chatClient = {
    dispatchSlash() {
      slashCount += 1;
      return slash.promise;
    },
    api: { send() { throw new Error('slash must not reach the worker send'); } }
  };

  const first = handleFormSubmit({ preventDefault() {} }, chatClient);
  const second = handleFormSubmit({ preventDefault() {} }, chatClient);
  await nextTick();
  t.is(slashCount, 1, 'a duplicate slash submit is dropped while pending');

  prompt.value = 'draft typed while waiting';
  slash.resolve(true);
  await Promise.all([first, second]);
  t.is(slashCount, 1);
  t.is(prompt.value, 'draft typed while waiting', 'slash completion preserves a newer draft');
});