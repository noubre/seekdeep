import test from 'brittle';
import { createRenderer, stripControls } from '../js/tui/render.js';

function capture(options = {}) {
  const chunks = [];
  const renderer = createRenderer({ write: (text) => chunks.push(text), ...options });
  return { renderer, output: () => chunks.join('') };
}

function plain(options = {}) {
  return capture({ depth: 'none', ...options });
}

const THINK_OPEN = '<' + 'think>';
const THINK_CLOSE = '<' + '/think>';

test('user writes a prefixed line', function (t) {
  const { renderer, output } = plain();
  renderer.user('hi');
  t.is(output(), 'you \u276f hi\n');
});

test('assistant streaming emits one prefix and the joined text', function (t) {
  const { renderer, output } = plain();
  renderer.assistantStart();
  renderer.assistantChunk('a');
  renderer.assistantChunk('b');
  renderer.assistantEnd();
  const text = output();
  t.ok(text.includes('ai \u276f ab\n'));
  t.is(text.split('ai \u276f ').length - 1, 1);
});

test('assistantStart is idempotent while streaming', function (t) {
  const { renderer, output } = plain();
  renderer.assistantStart();
  renderer.assistantStart();
  renderer.assistantChunk('x');
  renderer.assistantEnd();
  t.is(output().split('ai \u276f ').length - 1, 1);
});

test('reasoning block is hidden and the answer streams', function (t) {
  const { renderer, output } = plain({ animate: false });
  renderer.assistantStart();
  renderer.assistantChunk(THINK_OPEN);
  renderer.assistantChunk('secret reasoning');
  renderer.assistantChunk(THINK_CLOSE);
  renderer.assistantChunk('Hello');
  renderer.assistantChunk(' world');
  renderer.assistantEnd();
  const text = output();
  t.ok(text.includes('Hello world'));
  t.not(text.includes('secret reasoning'));
  t.ok(text.includes('thinking'));
});

test('unterminated reasoning block never leaks the text', function (t) {
  const { renderer, output } = plain({ animate: false });
  renderer.assistantStart();
  renderer.assistantChunk(THINK_OPEN);
  renderer.assistantChunk('still thinking');
  renderer.assistantEnd();
  const text = output();
  t.ok(text.includes('thinking'));
  t.not(text.includes('still thinking'));
  t.ok(text.endsWith('\n'));
});

test('plain text without markers is unchanged', function (t) {
  const { renderer, output } = plain({ animate: false });
  renderer.assistantStart();
  renderer.assistantChunk('hel');
  renderer.assistantChunk('lo');
  renderer.assistantEnd();
  t.is(output(), 'ai \u276f hello\n');
});

test('slash-error is red with color and plain without', function (t) {
  const colored = capture({ depth: 'truecolor' });
  colored.renderer.ephemeral('x', { kind: 'slash-error' });
  t.is(colored.output(), '\x1b[38;2;255;107;107m! x\n\x1b[0m');

  const disabled = plain();
  disabled.renderer.ephemeral('x', { kind: 'slash-error' });
  t.is(disabled.output(), '! x\n');
});

test('ephemeral strips control sequences from content', function (t) {
  const { renderer, output } = plain();
  renderer.ephemeral('\x1b[31mboom\x1b[0m', {});
  t.not(output().includes('\x1b'));
  t.ok(output().includes('boom'));
});

test('slash-help is dim when colored and plain-coloured when disabled', function (t) {
  const dim = capture({ depth: 'truecolor' });
  dim.renderer.ephemeral('help', { kind: 'slash-help' });
  t.is(dim.output(), '\x1b[2mhelp\n\x1b[0m');

  const disabled = plain();
  disabled.renderer.ephemeral('help', { kind: 'slash-help' });
  t.is(disabled.output(), 'help\n');
});

test('user carries the pear brand code under truecolor', function (t) {
  const { renderer, output } = capture({ depth: 'truecolor' });
  renderer.user('hi');
  t.ok(output().includes('\x1b[1;38;2;180;255;57m'));
});

test('banner lays out the brand, storage, topic and hint', function (t) {
  const { renderer, output } = plain();
  renderer.banner({ storage: '/tmp/x', topic: 'ab'.repeat(32) });
  const text = output();
  t.ok(text.includes('\u25c6 SeekDeep'));
  t.ok(text.includes('/tmp/x'));
  t.ok(text.includes('topic'));
  t.ok(text.includes('/tui for local commands'));
});

test('status summarizes the session snapshot', function (t) {
  const { renderer, output } = plain();
  renderer.status({ role: 'peer', topic: 'ab'.repeat(32), peerCount: 2, provider: 'ollama', model: 'm' });
  const text = output();
  t.ok(text.includes('[peer]'));
  t.ok(text.includes('peers=2'));
  t.ok(text.includes('provider=ollama'));
  t.ok(text.includes('model=m'));
});

test('harness renders plugin, sync and bot events and ignores others', function (t) {
  const { renderer, output } = plain();
  renderer.harness({ type: 'plugin', plugin: 'p2p', status: 'loaded' });
  renderer.harness({ type: 'sync', status: 'pushed', files: 3 });
  renderer.harness({ type: 'bot', kind: 'message', text: 'hi' });
  renderer.harness({ type: 'bot', kind: 'reply', text: 'yo' });
  renderer.harness({ type: 'unknown' });
  t.is(output(), '\u00b7 plugin p2p loaded\n\u00b7 sync pushed (3 files)\npeer-bot \u276f hi\nbot \u276f yo\n');
});

test('stripControls removes escapes and C0 controls but keeps newlines and tabs', function (t) {
  t.is(stripControls('a\x1b[31mb\x1b[0mc'), 'abc');
  t.is(stripControls('x\x07y'), 'xy');
  t.is(stripControls('a\n\tb'), 'a\n\tb');
  t.is(stripControls(null), '');
});

test('a multi-line markdown answer renders per line, prefix once', function (t) {
  const { renderer, output } = plain({ interactive: false });
  renderer.assistantStart();
  renderer.assistantChunk('## Title\n');
  renderer.assistantChunk('- one\n');
  renderer.assistantChunk('- **two**\n');
  renderer.assistantEnd();
  t.is(output(), 'ai \u276f Title\n\u2022 one\n\u2022 two\n');
});

test('an unterminated final line is flushed at assistantEnd', function (t) {
  const { renderer, output } = plain({ interactive: false });
  renderer.assistantStart();
  renderer.assistantChunk('he');
  renderer.assistantChunk('llo');
  renderer.assistantEnd();
  t.is(output(), 'ai \u276f hello\n');
});

test('interactive mode streams the partial line and restyles it on completion', function (t) {
  const { renderer, output } = plain({ interactive: true, columns: 80 });
  renderer.assistantStart();
  renderer.assistantChunk('**bo');
  renderer.assistantChunk('ld**\n');
  renderer.assistantEnd();
  const text = output();
  t.ok(text.includes('**bo'));      // streamed raw while in progress
  t.ok(text.includes('\r\x1b[J'));  // erased before restyle
  t.ok(text.endsWith('ai \u276f bold\n'));
});

test('markdown markers are resolved, not printed', function (t) {
  const { renderer, output } = plain({ interactive: false });
  renderer.assistantStart();
  renderer.assistantChunk('# Hi\n');
  renderer.assistantEnd();
  const text = output();
  t.ok(text.includes('ai \u276f Hi\n'));
  t.not(text.includes('#'));
});

test('interactive streaming emits the prefix exactly once across lines', function (t) {
  const { renderer, output } = plain({ interactive: true, columns: 80 });
  renderer.assistantStart();
  for (const c of ['line one\n', 'line two\n', 'line three']) renderer.assistantChunk(c);
  renderer.assistantEnd();
  const text = output().replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
  t.is(text.split('ai \u276f ').length - 1, 1);
  t.ok(text.includes('ai \u276f line one\n'));
  t.ok(text.includes('line two\n'));
});

test('non-interactive keeps one prefix when lines split across chunks', function (t) {
  const { renderer, output } = plain({ interactive: false });
  renderer.assistantStart();
  for (const c of ['para', 'graph\n', 'second\n']) renderer.assistantChunk(c);
  renderer.assistantEnd();
  t.is(output(), 'ai \u276f paragraph\nsecond\n');
});

test('a leading blank line does not emit a bare prefix', function (t) {
  const { renderer, output } = plain({ interactive: false });
  renderer.assistantStart();
  for (const c of ['\n', 'hi\n']) renderer.assistantChunk(c);
  renderer.assistantEnd();
  t.is(output(), 'ai \u276f hi\n');
});

test('interactive leading blank line also emits one prefix', function (t) {
  const { renderer, output } = plain({ interactive: true, columns: 80 });
  renderer.assistantStart();
  for (const c of ['\n', 'hi\n']) renderer.assistantChunk(c);
  renderer.assistantEnd();
  const text = output().replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
  t.is(text.split('ai \u276f ').length - 1, 1);
  t.ok(text.includes('ai \u276f hi\n'));
});
