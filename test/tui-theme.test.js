import test from 'brittle';
import { detectColorDepth, createTheme, PEAR_GREEN } from '../js/tui/theme.js';

test('PEAR_GREEN is the Pear lime brand shade', function (t) {
  t.is(PEAR_GREEN, '#B4FF39');
});

test('detectColorDepth evaluates TTY, NO_COLOR, COLORTERM and TERM in order', function (t) {
  t.is(detectColorDepth({}, false), 'none');
  t.is(detectColorDepth({ NO_COLOR: '1', COLORTERM: 'truecolor' }, true), 'none');
  t.is(detectColorDepth({ COLORTERM: 'truecolor' }, true), 'truecolor');
  t.is(detectColorDepth({ COLORTERM: '24bit' }, true), 'truecolor');
  t.is(detectColorDepth({ TERM: 'xterm-256color' }, true), '256');
  t.is(detectColorDepth({ TERM: 'screen' }, true), 'basic');
  t.is(detectColorDepth({ TERM: 'dumb' }, true), 'basic');
});

test('createTheme pear paint matches each depth', function (t) {
  t.is(createTheme('truecolor').pear('x'), '\x1b[38;2;180;255;57mx\x1b[0m');
  t.is(createTheme('256').pear('x'), '\x1b[38;5;191mx\x1b[0m');
  t.is(createTheme('basic').pear('x'), '\x1b[92mx\x1b[0m');
  t.is(createTheme('none').pear('x'), 'x');
});

test('createTheme pearBold and prompt', function (t) {
  t.is(createTheme('truecolor').pearBold('x'), '\x1b[1;38;2;180;255;57mx\x1b[0m');
  t.is(createTheme('none').pearBold('x'), 'x');
  t.is(createTheme('none').prompt, '\u276f ');
  t.is(createTheme('truecolor').prompt, '\x1b[38;2;180;255;57m\u276f\x1b[0m ');
});

test('createTheme red/gray/dim/bold parse at each depth', function (t) {
  t.is(createTheme('truecolor').red('x'), '\x1b[38;2;255;107;107mx\x1b[0m');
  t.is(createTheme('256').gray('x'), '\x1b[38;5;245mx\x1b[0m');
  t.is(createTheme('basic').red('x'), '\x1b[91mx\x1b[0m');
  t.is(createTheme('truecolor').dim('x'), '\x1b[2mx\x1b[0m');
  t.is(createTheme('truecolor').bold('x'), '\x1b[1mx\x1b[0m');
  t.is(createTheme('none').dim('x'), 'x');
  t.is(createTheme('none').bold('x'), 'x');
});

test('createTheme italic parses at each depth', function (t) {
  t.is(createTheme('truecolor').italic('x'), '\x1b[3mx\x1b[0m');
  t.is(createTheme('none').italic('x'), 'x');
});

test('createTheme paint rejects unknown tokens and is frozen', function (t) {
  const theme = createTheme('truecolor');
  t.is(Object.isFrozen(theme), true);
  let threw = null;
  try { theme.paint('x', 'nope'); } catch (error) { threw = error; }
  t.ok(threw instanceof TypeError);
  t.ok(/Unknown theme token/.test(threw.message));
});
