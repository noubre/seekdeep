import test from 'brittle';
import { classify, TUI_COMMANDS } from '../js/tui/commands.js';

test('classify treats non-string and blank input as empty', function (t) {
  t.alike(classify(undefined), { kind: 'empty' });
  t.alike(classify('   '), { kind: 'empty' });
  t.alike(classify(''), { kind: 'empty' });
});

test('classify recognizes TUI-local commands', function (t) {
  t.alike(classify('/models'), { kind: 'local', name: 'models', args: [], raw: '/models' });
  t.alike(classify('/status'), { kind: 'local', name: 'status', args: [], raw: '/status' });
});

test('classify forwards non-local slash commands verbatim', function (t) {
  t.alike(classify('/p2p help drive'), { kind: 'slash', name: 'p2p', raw: '/p2p help drive' });
  t.alike(classify('/nope'), { kind: 'slash', name: 'nope', raw: '/nope' });
});

test('classify honors quoted local arguments', function (t) {
  t.alike(classify('/model "llama 3"'), { kind: 'local', name: 'model', args: ['llama 3'], raw: '/model "llama 3"' });
  t.alike(classify('/join abc'), { kind: 'local', name: 'join', args: ['abc'], raw: '/join abc' });
});

test('classify treats ordinary text as a prompt', function (t) {
  t.alike(classify('hello'), { kind: 'prompt', raw: 'hello' });
  t.alike(classify('  spaced  '), { kind: 'prompt', raw: 'spaced' });
});

test('TUI_COMMANDS is frozen and collision-free with built-in plugin commands', function (t) {
  t.ok(Object.isFrozen(TUI_COMMANDS));
  for (const name of ['p2p', 'help', 'swarm', 'dht', 'drive', 'localdrive', 'mirror', 'beam', 'harness', 'bot']) {
    t.not(TUI_COMMANDS.includes(name));
  }
});
