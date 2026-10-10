import test from 'brittle';
import { createTheme } from '../js/tui/theme.js';
import { createBlockRenderer } from '../js/tui/markdown.js';

function plain() { return createBlockRenderer(createTheme('none')); }
function color() { return createBlockRenderer(createTheme('truecolor')); }

test('headers, bold, code and lists render as plain text at depth none', function (t) {
  const md = plain();
  t.is(md.writeLine('# Title'), 'Title');
  t.is(md.writeLine('## Sub'), 'Sub');
  t.is(md.writeLine('a **bold** and `code` here'), 'a bold and code here');
  t.is(md.writeLine('- one'), '\u2022 one');
  t.is(md.writeLine('1. first'), '1. first');
  t.is(md.writeLine('> quoted'), '\u2502 quoted');
  t.is(md.writeLine('---'), '\u2500'.repeat(40));
});

test('links become text (url); italic markers are stripped', function (t) {
  const md = plain();
  t.is(md.writeLine('see [docs](http://x.y)'), 'see docs (http://x.y)');
  t.is(md.writeLine('an *italic* word'), 'an italic word');
});

test('fenced code keeps its body verbatim and toggles state', function (t) {
  const md = plain();
  t.is(md.writeLine('```js'), '\u2502 ```js');
  t.is(md.writeLine('**not bold**'), '\u2502 **not bold**');
  t.is(md.writeLine('```'), '\u2502 ```');
  t.is(md.writeLine('**bold** again'), 'bold again');
});

test('reset() clears fence state between answers', function (t) {
  const md = plain();
  md.writeLine('```');
  md.writeLine('inside');
  md.reset();
  t.is(md.writeLine('**bold**'), 'bold');
});

test('inline styles carry ANSI under truecolor', function (t) {
  const md = color();
  t.is(md.writeLine('a **b**'), 'a \x1b[1mb\x1b[0m');
  t.is(md.writeLine('`c`'), '\x1b[38;2;138;138;138mc\x1b[0m');
});