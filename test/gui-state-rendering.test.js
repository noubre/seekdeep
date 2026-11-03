import test from 'brittle';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { initializeElements } from '../js/ui/elements.js';
import { initializeRendering } from '../js/ui/rendering.js';
import { clientState, INITIAL_STATE } from '../js/session/client-state.js';
import { clear } from '../js/messages/store.js';

function installAppDom() {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const dom = new JSDOM(html, { url: 'http://seekdeep.local/' });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.requestAnimationFrame = (callback) => {
    callback();
    return 1;
  };
  initializeElements();
  clear();
  clientState.setState({ ...INITIAL_STATE });
  initializeRendering();
  return dom;
}

test('renderer projects room and host controls from client state', function (t) {
  const dom = installAppDom();
  const topic = 'ab'.repeat(32);

  clientState.setState({
    topic,
    role: 'host',
    provider: 'lmstudio',
    collaborative: true,
    peers: [{ id: 'peer-1', displayName: 'Peer One', role: 'peer' }],
    models: [{ id: 'model-1', name: 'Model One' }]
  });

  const document = dom.window.document;
  const topicElement = document.getElementById('current-topic');
  const topicContainer = topicElement.parentElement;
  const provider = document.getElementById('provider-select');
  const model = document.getElementById('model-select');
  const mode = document.getElementById('chat-mode');
  const users = Array.from(document.querySelectorAll('#active-users .user-chip'));

  t.is(topicElement.textContent, topic, 'current room key is visible');
  t.absent(topicContainer.classList.contains('hidden'), 'topic container is shown');
  t.is(topicContainer.getAttribute('style'), null, 'visibility is class-driven, not inline');
  t.is(provider.value, 'lmstudio', 'provider follows worker state');
  t.absent(provider.disabled, 'host can change provider');
  t.is(model.value, 'model-1', 'model list follows worker state');
  t.is(mode.value, 'collaborative', 'mode follows worker state');
  t.absent(mode.disabled, 'host can change mode');
  t.alike(users.map((node) => node.textContent), ['You', 'Peer One']);

  clientState.setState({ topic: null, role: 'peer', provider: 'ollama' });
  t.is(topicElement.textContent, '', 'topic clears after leaving');
  t.ok(topicContainer.classList.contains('hidden'), 'empty topic container is hidden');
  t.is(topicContainer.getAttribute('style'), null, 'hiding does not write inline styles');
  t.ok(provider.disabled, 'peer cannot change provider');
  t.ok(mode.disabled, 'peer cannot change mode');
});