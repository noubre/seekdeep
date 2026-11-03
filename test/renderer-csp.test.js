import test from 'brittle';
import { readFileSync } from 'node:fs';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { initializeElements } from '../js/ui/elements.js';
import { initializeRendering } from '../js/ui/rendering.js';
import { initializeHistoryBrowser, toggleHistoryBrowser, isOpen } from '../js/ui/history-browser.js';
import { clientState, INITIAL_STATE } from '../js/session/client-state.js';
import { clear } from '../js/messages/store.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function read(relativePath) {
  return readFileSync(resolve(ROOT, relativePath), 'utf8');
}

function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

function importsOf(source) {
  const specifiers = [];
  const pattern = /\bimport\s+(?:[^'"]+?\s+from\s+)?['"]([^'"]+)['"]/g;
  let match;
  while ((match = pattern.exec(stripComments(source))) !== null) specifiers.push(match[1]);
  return specifiers;
}

/** Walk the renderer's static ES module import graph from js/main.js. */
function rendererGraph(entry = 'js/main.js') {
  const files = new Map();
  const bareSpecifiers = [];
  const queue = [resolve(ROOT, entry)];
  while (queue.length) {
    const file = queue.shift();
    if (files.has(file)) continue;
    files.set(file, readFileSync(file, 'utf8'));
    for (const specifier of importsOf(files.get(file))) {
      if (!specifier.startsWith('.')) {
        bareSpecifiers.push({ file, specifier });
        continue;
      }
      queue.push(resolve(dirname(file), specifier));
    }
  }
  return { files, bareSpecifiers };
}

test('renderer module graph never reaches b4a, Eval, or the worker RPC server', function (t) {
  const html = read('index.html');
  t.ok(/<script\s+type="module"\s+src="\.\/js\/main\.js"><\/script>/.test(html), 'index.html boots js/main.js');

  const { files, bareSpecifiers } = rendererGraph();
  const names = Array.from(files.keys()).map((file) => file.slice(ROOT.length + 1));

  t.alike(bareSpecifiers, [], 'renderer graph has no bare-module imports');
  t.ok(names.includes('js/p2p/rpc-codec.js'), 'client uses the shared browser-safe codec');
  t.absent(names.some((name) => name.endsWith('js/p2p/rpc-server.js')), 'rpc-server is not in the renderer graph');
  t.absent(names.some((name) => name.includes('node_modules/')), 'renderer graph does not load node_modules');

  for (const name of names) {
    const source = stripComments(files.get(resolve(ROOT, name)));
    t.absent(/\bfrom\s+['"]b4a['"]|\brequire\(\s*['"]b4a['"]\s*\)|\bb4a\./.test(source),
      `${name} has no b4a dependency`);
    t.absent(/\beval\s*\(|new\s+Function\s*\(/.test(source), `${name} does not evaluate strings`);
  }
});

test('rpc-client imports only the browser-safe codec and method allowlist', function (t) {
  const source = read('js/p2p/rpc-client.js');
  const specifiers = importsOf(source).sort();
  t.alike(specifiers, ['./rpc-codec.js', './rpc-methods.js'].sort(), 'client import boundary is explicit');
  t.absent(/\bb4a\b/.test(source), 'no b4a token remains in the client');
});

test('renderer UI modules never assign inline styles', function (t) {
  for (const file of ['js/ui/elements.js', 'js/ui/rendering.js', 'js/ui/history-browser.js']) {
    const source = stripComments(read(file));
    t.absent(/\.style\s*(?:\.|\[|=)|setAttribute\s*\(\s*['"]style['"]|\.cssText\s*=/.test(source),
      `${file} writes no inline styles`);
  }
});

test('CSP allows the app modules and the one SVG data image without unsafe sources', function (t) {
  const html = read('index.html');
  const match = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)">/);
  t.ok(match, 'CSP meta tag is present');
  const policy = match[1];
  t.absent(/unsafe-eval/.test(policy), 'CSP does not allow unsafe-eval');
  t.absent(/unsafe-inline/.test(policy), 'CSP does not allow unsafe-inline');
  t.ok(/default-src 'self'/.test(policy), 'default-src stays self');
  t.ok(/script-src 'self'(?:;|$)/.test(policy), 'script-src stays self');
  t.ok(/style-src 'self'(?:;|$)/.test(policy), 'style-src stays self');
  t.ok(/img-src 'self' data:/.test(policy), 'img-src grants only self and data for the embedded SVG');

  const css = read('css/app.css');
  t.ok(css.includes('data:image/svg+xml'), 'the embedded SVG is the reason img-src data: exists');
  t.ok(/\.hidden\s*\{\s*display:\s*none\s*!important/.test(css), 'hidden class is available');
  t.ok(/#history-sidebar\.open\s*\{[^}]*translateX\(0\)/.test(css), 'sidebar open state is class-driven');
  t.ok(/#history-overlay\.open\s*\{[^}]*display:\s*block/.test(css), 'overlay open state is class-driven');
});

test('topic and history controls toggle classes, never inline style attributes', function (t) {
  const html = read('index.html');
  const dom = new JSDOM(html, { url: 'http://seekdeep.local/' });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.requestAnimationFrame = (callback) => { callback(); return 1; };
  globalThis.localStorage = dom.window.localStorage;

  const document = dom.window.document;
  initializeElements();
  clear();
  clientState.setState({ ...INITIAL_STATE });
  initializeRendering();
  initializeHistoryBrowser();

  const topicElement = document.getElementById('current-topic');
  const topicContainer = topicElement.parentElement;
  clientState.setState({ topic: 'ab'.repeat(32), role: 'host' });
  t.is(topicElement.textContent, 'ab'.repeat(32), 'current topic renders 64 hex characters');
  t.absent(topicContainer.classList.contains('hidden'), 'topic container visible');
  t.is(topicContainer.getAttribute('style'), null, 'topic toggle wrote no inline style');

  clientState.setState({ topic: null });
  t.ok(topicContainer.classList.contains('hidden'), 'topic container hides via class');
  t.is(topicContainer.getAttribute('style'), null, 'hidden topic wrote no inline style');

  const youChip = document.querySelector('#active-users .user-chip');
  t.ok(youChip.classList.contains('user-chip-self'), 'local user color comes from a class');
  t.is(youChip.getAttribute('style'), null, 'user chip wrote no inline style');

  const sidebar = document.getElementById('history-sidebar');
  const overlay = document.getElementById('history-overlay');
  t.absent(isOpen(), 'history starts closed');
  t.is(sidebar.getAttribute('style'), null, 'closed sidebar has no inline style');
  toggleHistoryBrowser();
  t.ok(isOpen(), 'history opens');
  t.ok(sidebar.classList.contains('open'), 'sidebar opens via class');
  t.ok(overlay.classList.contains('open'), 'overlay opens via class');
  t.is(sidebar.getAttribute('style'), null, 'sidebar toggle wrote no inline style');
  t.is(overlay.getAttribute('style'), null, 'overlay toggle wrote no inline style');
  toggleHistoryBrowser();
  t.absent(sidebar.classList.contains('open'), 'sidebar closes via class');
  t.absent(overlay.classList.contains('open'), 'overlay closes via class');
});
