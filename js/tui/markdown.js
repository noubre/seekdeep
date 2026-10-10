/**
 * Minimal terminal Markdown renderer.
 *
 * Line-oriented: `createBlockRenderer(theme)` renders one logical line at a
 * time and carries fenced-code state across the lines of a single answer
 * (call `reset()` between answers). Pure: the only output is a string. At
 * colour depth `none` the theme is a no-op, so markers are stripped and plain
 * text is returned.
 */
const CODE = /^`([^`]+)`/;
const BOLD = /^\*\*([^*]+)\*\*/;
const ITALIC_STAR = /^\*([^*\n]+)\*/;
const ITALIC_UNDER = /^_([^_\n]+)_/;
const LINK = /^\[([^\]]+)\]\(([^)]+)\)/;

/** Remove inline markers without adding any styling (for use inside a styled block). */
function stripInline(text) {
  return text
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*\n]+)\*/g, '$1')
    .replace(/_([^_\n]+)_/g, '$1')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)');
}

/** Style a line's inline spans. Never wraps the whole line in another style. */
function renderInline(text, theme) {
  let out = '';
  let i = 0;
  while (i < text.length) {
    const rest = text.slice(i);
    let m;
    if ((m = CODE.exec(rest))) { out += theme.gray(m[1]); i += m[0].length; continue; }
    if ((m = BOLD.exec(rest))) { out += theme.bold(m[1]); i += m[0].length; continue; }
    if ((m = LINK.exec(rest))) { out += `${m[1]} ${theme.dim(`(${m[2]})`)}`; i += m[0].length; continue; }
    if ((m = ITALIC_STAR.exec(rest))) { out += theme.italic(m[1]); i += m[0].length; continue; }
    if ((m = ITALIC_UNDER.exec(rest))) { out += theme.italic(m[1]); i += m[0].length; continue; }
    out += rest[0];
    i += 1;
  }
  return out;
}

function createBlockRenderer(theme, options = {}) {
  const ruleWidth = Number.isSafeInteger(options.ruleWidth) && options.ruleWidth > 0 ? options.ruleWidth : 40;
  let inFence = false;

  function reset() { inFence = false; }

  function writeLine(line) {
    const text = String(line ?? '');
    const fence = /^\s{0,3}(```|~~~)/.exec(text);
    if (fence) {
      inFence = !inFence;
      return theme.gray('\u2502 ' + text.trim());
    }
    if (inFence) return theme.gray('\u2502 ' + text);

    if (/^\s{0,3}([-*_])\1{2,}\s*$/.test(text)) return theme.dim('\u2500'.repeat(ruleWidth));

    const heading = /^\s{0,3}(#{1,6})\s+(.*)$/.exec(text);
    if (heading) return theme.pearBold(stripInline(heading[2]).trimEnd());

    const quote = /^\s{0,3}>\s?(.*)$/.exec(text);
    if (quote) return theme.dim('\u2502 ' + stripInline(quote[1]));

    const bullet = /^\s*[-*+]\s+(.*)$/.exec(text);
    if (bullet) return `${theme.pear('\u2022')} ${renderInline(bullet[1], theme)}`;

    const ordered = /^\s*(\d+)[.)]\s+(.*)$/.exec(text);
    if (ordered) return `${theme.bold(ordered[1] + '.')} ${renderInline(ordered[2], theme)}`;

    return renderInline(text, theme);
  }

  return { writeLine, reset };
}

export { createBlockRenderer, renderInline, stripInline };