/**
 * Parse SeekDeep slash tags typed into the chat composer.
 */

/**
 * Check whether text begins with a slash after optional leading whitespace.
 *
 * @param {*} text
 * @returns {boolean}
 */
function isSlashTag(text) {
  return typeof text === 'string' && text.trimStart().startsWith('/');
}

/**
 * Split an argument string while honoring quotes and backslash escapes.
 *
 * @param {string} input
 * @returns {string[]}
 */
function tokenize(input) {
  const tokens = [];
  let current = '';
  let quote = null;
  let escaping = false;
  let tokenStarted = false;

  for (const char of input) {
    if (escaping) {
      current += char;
      escaping = false;
      tokenStarted = true;
      continue;
    }

    if (char === '\\') {
      escaping = true;
      tokenStarted = true;
      continue;
    }

    if (quote) {
      if (char === quote) {
        quote = null;
      } else {
        current += char;
      }
      tokenStarted = true;
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      tokenStarted = true;
      continue;
    }

    if (/\s/.test(char)) {
      if (tokenStarted) {
        tokens.push(current);
        current = '';
        tokenStarted = false;
      }
      continue;
    }

    current += char;
    tokenStarted = true;
  }

  if (quote) throw new Error('Unclosed quote in slash tag');

  if (escaping) current += '\\';
  if (tokenStarted) tokens.push(current);

  return tokens;
}

/**
 * Parse a slash tag into its command, positional arguments, and flags.
 *
 * @param {string} text
 * @returns {{raw: string, command: string, args: string[], flags: Object}}
 */
function parseSlashTag(text) {
  if (typeof text !== 'string') throw new TypeError('Slash tag input must be a string');

  const raw = text.trim();
  if (!raw.startsWith('/')) throw new Error('Not a slash tag');

  const tokens = tokenize(raw.slice(1));
  const command = (tokens.shift() || '').toLowerCase();
  if (!command) throw new Error('Missing slash command');

  const args = [];
  const flags = {};
  let flagsEnded = false;

  for (const token of tokens) {
    if (flagsEnded || !token.startsWith('--')) {
      args.push(token);
      continue;
    }

    if (token === '--') {
      flagsEnded = true;
      continue;
    }

    const body = token.slice(2);
    const equalsIndex = body.indexOf('=');
    const name = equalsIndex === -1 ? body : body.slice(0, equalsIndex);

    if (!/^[A-Za-z0-9_][A-Za-z0-9_-]*$/.test(name)) {
      throw new Error(`Invalid flag name: ${name || '(empty)'}`);
    }

    const value = equalsIndex === -1 ? true : body.slice(equalsIndex + 1);
    Object.defineProperty(flags, name, {
      value,
      enumerable: true,
      configurable: true,
      writable: true
    });
  }

  return { raw, command, args, flags };
}

export { isSlashTag, parseSlashTag };
