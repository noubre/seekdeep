/**
 * Parse harness launch arguments from the Pear config/Bare argv.
 */
const KEY_PATTERN = /^[0-9a-f]{64}$/i;
const PREFIX = '--harness-key=';

function parseHarnessKey(args) {
  if (!Array.isArray(args)) return { harnessKey: null };
  for (const arg of args) {
    if (typeof arg !== 'string' || !arg.startsWith(PREFIX)) continue;
    const value = arg.slice(PREFIX.length).trim();
    return { harnessKey: KEY_PATTERN.test(value) ? value.toLowerCase() : null };
  }
  return { harnessKey: null };
}

export { parseHarnessKey, KEY_PATTERN };
