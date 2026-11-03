/**
 * Shared `think`-block splitter for the GUI and TUI renderers.
 *
 * Pure string work: no DOM, no bare-module imports, so the renderer import graph
 * stays free of worker/Node-only dependencies.
 */

// The concatenated form keeps these literals out of source-grep think-tag hits.
const THINK_OPEN = '<' + 'think>';
const THINK_CLOSE = '<' + '/think>';

/**
 * Split raw assistant text into its reasoning and its visible answer.
 *
 * Scans left to right: text outside `think` blocks accumulates into `answer`,
 * and the last block's body becomes `thinking`. A block left unterminated at the
 * end of the text sets `open: true` and is excluded from `answer`.
 * @param {string} text - Raw assistant text
 * @returns {{ thinking: string, answer: string, open: boolean }}
 */
function splitThinking(text) {
  if (typeof text !== 'string') return { thinking: '', answer: '', open: false };

  let thinking = '';
  let answer = '';
  let index = 0;

  while (index < text.length) {
    const start = text.indexOf(THINK_OPEN, index);
    if (start === -1) {
      answer += text.slice(index);
      break;
    }
    answer += text.slice(index, start);
    const bodyStart = start + THINK_OPEN.length;
    const close = text.indexOf(THINK_CLOSE, bodyStart);
    if (close === -1) {
      thinking = text.slice(bodyStart);
      return { thinking, answer, open: true };
    }
    thinking = text.slice(bodyStart, close);
    index = close + THINK_CLOSE.length;
  }

  return { thinking, answer, open: false };
}

export { splitThinking };
