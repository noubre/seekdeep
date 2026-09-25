import test from 'brittle';
import { parseSlashTag, isSlashTag } from '../js/slash/parser.js';

test('isSlashTag detects only leading slash tags', function (t) {
  t.is(isSlashTag('/swarm status'), true, 'leading slash is a tag');
  t.is(isSlashTag(' /swarm status'), true, 'leading whitespace is ignored');
  t.is(isSlashTag('\t/swarm status'), true, 'all leading whitespace is ignored');
  t.is(isSlashTag('ask /swarm status'), false, 'slash inside natural text is not a tag');
  t.is(isSlashTag(''), false, 'empty string is not a tag');
  t.is(isSlashTag(null), false, 'non-string input is not a tag');
});

test('parseSlashTag parses command, args, and flags', function (t) {
  t.alike(parseSlashTag('/swarm status'), {
    raw: '/swarm status',
    command: 'swarm',
    args: ['status'],
    flags: {}
  });

  t.alike(parseSlashTag('/localdrive add "Advisor Vault" ~/Documents/FCFA --read-only'), {
    raw: '/localdrive add "Advisor Vault" ~/Documents/FCFA --read-only',
    command: 'localdrive',
    args: ['add', 'Advisor Vault', '~/Documents/FCFA'],
    flags: { 'read-only': true }
  });

  t.alike(parseSlashTag('/drive create notes --mode=private'), {
    raw: '/drive create notes --mode=private',
    command: 'drive',
    args: ['create', 'notes'],
    flags: { mode: 'private' }
  });
});

test('parseSlashTag supports quoting, escapes, and normalized commands', function (t) {
  t.alike(parseSlashTag("  /DRIVE create 'Team Notes' escaped\\ value \\\"quoted\\\" --label=work\\ files  "), {
    raw: "/DRIVE create 'Team Notes' escaped\\ value \\\"quoted\\\" --label=work\\ files",
    command: 'drive',
    args: ['create', 'Team Notes', 'escaped value', '"quoted"'],
    flags: { label: 'work files' }
  });

  t.alike(parseSlashTag("/drive create 'it\\'s private'"), {
    raw: "/drive create 'it\\'s private'",
    command: 'drive',
    args: ['create', "it's private"],
    flags: {}
  });
});

test('parseSlashTag rejects invalid input', async function (t) {
  await t.exception(() => parseSlashTag('/drive create "missing end'), /Unclosed quote/);
  await t.exception(() => parseSlashTag("/drive create 'missing end"), /Unclosed quote/);
  await t.exception(() => parseSlashTag('ask /swarm status'), /Not a slash tag/);
  await t.exception(() => parseSlashTag(''), /Not a slash tag/);
  await t.exception(() => parseSlashTag('/   '), /Missing slash command/);
  await t.exception.all(() => parseSlashTag(null), /must be a string/);
  await t.exception.all(() => parseSlashTag(undefined), /must be a string/);
  await t.exception.all(() => parseSlashTag(42), /must be a string/);
  await t.exception.all(() => parseSlashTag({ toString: () => '/drive status' }), /must be a string/);
  await t.exception(() => parseSlashTag('/drive --=value'), /Invalid flag name/);
  await t.exception(() => parseSlashTag('/drive ---=value'), /Invalid flag name/);
  await t.exception(() => parseSlashTag('/drive --bad!'), /Invalid flag name/);
});

test('parseSlashTag safely preserves prototype-sensitive flag names', function (t) {
  const parsed = parseSlashTag('/drive --__proto__=safe --constructor=ctor --prototype=proto');

  t.is(Object.getPrototypeOf(parsed.flags), Object.prototype, 'flags retain ordinary object behavior');
  t.is(Object.hasOwn(parsed.flags, '__proto__'), true, '__proto__ is an own flag');
  t.is(parsed.flags.__proto__, 'safe');
  t.is(parsed.flags.constructor, 'ctor');
  t.is(parsed.flags.prototype, 'proto');
  t.alike(Object.keys(parsed.flags), ['__proto__', 'constructor', 'prototype']);
});

test('parseSlashTag supports an end-of-flags marker', function (t) {
  t.alike(parseSlashTag('/drive --mode=private -- --literal --=value --'), {
    raw: '/drive --mode=private -- --literal --=value --',
    command: 'drive',
    args: ['--literal', '--=value', '--'],
    flags: { mode: 'private' }
  });
});
