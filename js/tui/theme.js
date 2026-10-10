/**
 * Pear-green terminal theme.
 *
 * Maps a detected colour depth (`none` | `basic` | `256` | `truecolor`) to a
 * small palette of SGR fragments. Remote content is never passed through
 * `paint` without prior sanitisation by the renderer.
 */

export const PEAR_GREEN = '#B4FF39';

const PALETTE = {
  pear: { truecolor: '38;2;180;255;57', '256': '38;5;191', basic: '92' },
  red: { truecolor: '38;2;255;107;107', '256': '38;5;203', basic: '91' },
  gray: { truecolor: '38;2;138;138;138', '256': '38;5;245', basic: '90' }
};

/**
 * Pick a colour depth from the environment, evaluated top to bottom.
 *
 * @param {Record<string, unknown>} [env]
 * @param {boolean} [isTTY]
 * @returns {'none' | 'basic' | '256' | 'truecolor'}
 */
export function detectColorDepth(env = process.env, isTTY = false) {
  if (isTTY !== true) return 'none';
  if (env.NO_COLOR !== undefined) return 'none';

  const colorterm = String(env.COLORTERM).toLowerCase();
  if (colorterm === 'truecolor' || colorterm === '24bit') return 'truecolor';

  const term = String(env.TERM).toLowerCase();
  if (term.includes('truecolor') || term.includes('direct') || term.includes('24bit')) return 'truecolor';
  if (term.includes('256')) return '256';
  return 'basic';
}

function sgr(code, text) {
  return `\x1b[${code}m${text}\x1b[0m`;
}

/**
 * Build a frozen theme for a colour depth.
 *
 * @param {'none' | 'basic' | '256' | 'truecolor'} [depth]
 */
export function createTheme(depth = 'truecolor') {
  const enabled = depth !== 'none';
  const palette = PALETTE.pear[depth] ? depth : 'basic';

  function paint(text, token) {
    if (!Object.prototype.hasOwnProperty.call(PALETTE, token)) {
      throw new TypeError(`Unknown theme token: ${token}`);
    }
    if (!enabled) return text;
    return sgr(PALETTE[token][palette], text);
  }

  function attribute(code, text) {
    return enabled ? sgr(code, text) : text;
  }

  const theme = {
    paint,
    dim: (text) => attribute('2', text),
    bold: (text) => attribute('1', text),
    italic: (text) => attribute('3', text),
    pear: (text) => paint(text, 'pear'),
    red: (text) => paint(text, 'red'),
    gray: (text) => paint(text, 'gray'),
    pearBold: (text) => (enabled
      ? `\x1b[1;${PALETTE.pear[palette]}m${text}\x1b[0m`
      : text),
    prompt: enabled ? `${sgr(PALETTE.pear[palette], '\u276f')} ` : '\u276f '
  };

  return Object.freeze(theme);
}
