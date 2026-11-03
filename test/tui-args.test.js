import test from 'brittle';
import { parseTuiArgs, DEFAULT_STORAGE_DIRNAME } from '../js/tui/args.js';

test('parseTuiArgs honours an absolute --storage flag', function (t) {
  const parsed = parseTuiArgs(['--storage=/tmp/seekdeep-store'], { env: {}, homedir: '/home/x' });
  t.is(parsed.storage, '/tmp/seekdeep-store');
});

test('parseTuiArgs ignores a relative --storage and falls back', function (t) {
  const parsed = parseTuiArgs(['--storage=relative/path'], { env: {}, homedir: '/home/x' });
  t.is(parsed.storage, `/home/x/${DEFAULT_STORAGE_DIRNAME}`);
});

test('parseTuiArgs uses SEEKDEEP_STORAGE when the flag is absent', function (t) {
  const parsed = parseTuiArgs([], { env: { SEEKDEEP_STORAGE: '/var/lib/seekdeep' }, homedir: '/home/x' });
  t.is(parsed.storage, '/var/lib/seekdeep');
});

test('parseTuiArgs falls back to the home directory', function (t) {
  const parsed = parseTuiArgs([], { env: {}, homedir: '/home/x' });
  t.is(parsed.storage, `/home/x/${DEFAULT_STORAGE_DIRNAME}`);
});

test('parseTuiArgs validates and lowercases --topic', function (t) {
  const hex = 'AB'.repeat(32);
  t.is(parseTuiArgs([`--topic=${hex}`], { env: {}, homedir: '/home/x' }).topic, hex.toLowerCase());
  t.is(parseTuiArgs(['--topic=nothex'], { env: {}, homedir: '/home/x' }).topic, null);
  t.is(parseTuiArgs([`--topic=${'a'.repeat(63)}`], { env: {}, homedir: '/home/x' }).topic, null);
});

test('parseTuiArgs disables color via --no-color or NO_COLOR', function (t) {
  t.is(parseTuiArgs(['--no-color'], { env: {}, homedir: '/home/x' }).color, false);
  t.is(parseTuiArgs([], { env: { NO_COLOR: '1' }, homedir: '/home/x' }).color, false);
  t.is(parseTuiArgs([], { env: {}, homedir: '/home/x' }).color, true);
});

test('parseTuiArgs keeps valid model/provider and ignores bogus values', function (t) {
  const parsed = parseTuiArgs(['--model=llama3.1', '--provider=lmstudio'], { env: {}, homedir: '/home/x' });
  t.is(parsed.model, 'llama3.1');
  t.is(parsed.provider, 'lmstudio');
  t.is(parseTuiArgs(['--provider=bogus'], { env: {}, homedir: '/home/x' }).provider, null);
  t.is(parseTuiArgs(['--provider=bogus'], { env: {}, homedir: '/home/x' }).model, null);
});

test('parseTuiArgs tolerates non-array and non-string input', function (t) {
  t.is(parseTuiArgs(undefined, { env: {}, homedir: '/home/x' }).storage, `/home/x/${DEFAULT_STORAGE_DIRNAME}`);
  t.is(parseTuiArgs([42, null], { env: {}, homedir: '/home/x' }).storage, `/home/x/${DEFAULT_STORAGE_DIRNAME}`);
});
