/**
 * Terminal renderer.
 *
 * Owns no terminal and no global state: the caller supplies `write` and a
 * colour `depth`. Every inbound string is sanitised with `stripControls` before
 * it is themed, so peer names/text, slash output, and error messages can never
 * inject escape sequences into the terminal.
 */
import { createTheme } from './theme.js';
import { createBlockRenderer } from './markdown.js';

const ESCAPE_PATTERN = /\x1b\[[0-9;?]*[ -/]*[@-~]/g;
const CONTROL_PATTERN = /[\x00-\x08\x0b-\x1f\x7f]/g;

function stripControls(text) {
  if (typeof text !== 'string') return '';
  return text.replace(ESCAPE_PATTERN, '').replace(CONTROL_PATTERN, '');
}

function createRenderer(options = {}) {
  const write = options.write;
  if (typeof write !== 'function') throw new TypeError('Renderer requires a write function');
  const theme = createTheme(options.depth);
  const animate = options.animate === true;
  const interactive = options.interactive === true;
  const columns = Number.isSafeInteger(options.columns) && options.columns > 0
    ? options.columns
    : (Number.isSafeInteger(process.stdout && process.stdout.columns) && process.stdout.columns > 0
      ? process.stdout.columns
      : 80);
  const markdown = createBlockRenderer(theme);

  const thinkOpenTag = '<' + 'think>';
  const thinkCloseTag = '<' + '/think>';
  const SPINNER = ['\u280b', '\u2819', '\u2839', '\u2838', '\u283c', '\u2834', '\u2826', '\u2827', '\u2807', '\u280f'];
  const FRAME_MS = 120;

  let streaming = false;
  let raw = '';
  let shown = 0;
  let thinking = false;
  let frame = 0;
  let timer = null;
  let partial = '';       // raw text of the in-progress answer line
  let partialRows = 0;    // terminal rows it occupies
  let needsPrefix = true; // next visible answer text needs the "ai ❯ " prefix
  let lineOpen = false;   // something is written on the current row, unterminated
  const prefix = `${theme.pearBold('ai')}${theme.gray(' \u276f ')}`;

  function out(text) {
    write(text);
  }

  function stopTimer() {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  function drawThinking() {
    out('\r\x1b[K' + theme.dim('thinking ' + SPINNER[frame % SPINNER.length]));
    lineOpen = true;
  }

  function showThinking() {
    if (needsPrefix) writePrefix();
    if (!animate) {
      out('thinking\u2026');
      lineOpen = true;
      return;
    }
    frame = 0;
    drawThinking();
    timer = setInterval(() => {
      frame += 1;
      drawThinking();
    }, FRAME_MS);
    if (typeof timer.unref === 'function') timer.unref();
  }

  // Leave the indicator line (terminating it when non-animated) so the answer
  // can resume from a fresh prefix without smearing.
  function clearThinking() {
    stopTimer();
    if (animate) out('\r\x1b[K');
    else out('\n');
    lineOpen = false;
  }

  function writePrefix() {
    out(prefix);
    needsPrefix = false;
    lineOpen = true;
  }

  /** Erase the in-progress line from the screen (interactive only) and reset line state. */
  function erasePartial() {
    if (!partial) return;
    if (interactive) {
      let seq = '';
      if (partialRows > 1) seq += `\x1b[${partialRows - 1}A`;
      seq += '\r\x1b[J';
      out(seq);
    }
    partial = '';
    partialRows = 0;
    needsPrefix = true;
    lineOpen = false;
  }

  /** Write one completed (already-sanitised, marker-free) answer line, markdown-rendered. */
  function emitLine(text) {
    out(markdown.writeLine(text) + '\n');
    lineOpen = false;
  }

  // Split accumulated raw text into the visible answer (all closed thinking
  // blocks removed, trailing unclosed block removed) and whether the text now
  // ends inside an open thinking block.
  function parseThinking(text) {
    let answer = '';
    let index = 0;
    while (index < text.length) {
      const open = text.indexOf(thinkOpenTag, index);
      if (open === -1) {
        answer += text.slice(index);
        break;
      }
      answer += text.slice(index, open);
      const close = text.indexOf(thinkCloseTag, open + thinkOpenTag.length);
      if (close === -1) return { answer, open: true };
      index = close + thinkCloseTag.length;
    }
    return { answer, open: false };
  }

  function banner(info = {}) {
    const storage = info.storage ? stripControls(String(info.storage)) : null;
    out(`${theme.pearBold('\u25c6 SeekDeep')} ${theme.gray('terminal')}\n`);
    if (storage) out(`${theme.gray('storage')}  ${storage}\n`);
    out(`${theme.gray('topic')}    ${info.topic ? stripControls(String(info.topic)) : theme.gray('none')}\n`);
    out(`${theme.dim('/tui for local commands \u00b7 every other /command runs in the plugin harness')}\n`);
    out(`${theme.gray('\u2500'.repeat(44))}\n`);
  }

  function user(text) {
    out(`${theme.pearBold('you')}${theme.gray(' \u276f ')}${stripControls(text)}\n`);
  }

  function assistantStart() {
    if (streaming) return;
    streaming = true;
    raw = '';
    shown = 0;
    thinking = false;
    partial = '';
    partialRows = 0;
    needsPrefix = true;
    lineOpen = false;
    markdown.reset();
  }

  function assistantChunk(text) {
    raw += stripControls(text);
    const { answer, open } = parseThinking(raw);
    if (open) {
      if (!thinking) {
        thinking = true;
        showThinking();
      }
      return;
    }
    if (thinking) {
      clearThinking();
      thinking = false;
      needsPrefix = true;
    }
    if (answer.length <= shown) return;
    let delta = answer.slice(shown);
    shown = answer.length;

    let nl;
    while ((nl = delta.indexOf('\n')) !== -1) {
      const line = partial + delta.slice(0, nl);
      delta = delta.slice(nl + 1);
      erasePartial();
      if (needsPrefix) writePrefix();
      emitLine(line);
    }
    if (!delta) return;
    if (interactive) {
      if (needsPrefix) writePrefix();
      out(delta);
      partial += delta;
      partialRows = Math.max(1, Math.ceil((4 + partial.length) / columns)); // 4 = visible width of "ai ❯ "
      lineOpen = true;
    } else {
      partial += delta; // hold back until the line completes
    }
  }

  function assistantEnd() {
    if (!streaming) return;
    streaming = false;
    stopTimer();
    thinking = false;
    if (partial) {
      const line = partial;
      erasePartial();
      if (needsPrefix) writePrefix();
      emitLine(line);
    }
    if (lineOpen) out('\n');
  }

  function system(text) {
    out(`${theme.dim('\u00b7 ' + stripControls(text))}\n`);
  }

  function peer(name, text) {
    out(`${theme.pear(stripControls(name))}${theme.gray(' \u276f ')}${stripControls(text)}\n`);
  }

  function error(text) {
    out(`${theme.red('! ' + stripControls(text))}\n`);
  }

  function ephemeral(content, metadata = {}) {
    const body = stripControls(String(content ?? ''));
    const kind = metadata?.kind;
    if (kind === 'slash-error') return out(theme.red('! ' + body + '\n'));
    if (kind === 'slash-help' || kind === 'slash-placeholder') return out(theme.dim(body + '\n'));
    return out(`${body}\n`);
  }

  function harness(event) {
    if (!event || typeof event !== 'object') return;
    if (event.type === 'plugin') {
      return out(`${theme.dim(`\u00b7 plugin ${stripControls(event.plugin)} ${stripControls(event.status)}`)}\n`);
    }
    if (event.type === 'sync') {
      const files = Number.isSafeInteger(event.files) ? ` (${event.files} files)` : '';
      return out(`${theme.dim(`\u00b7 sync ${stripControls(event.status)}${files}`)}\n`);
    }
    if (event.type === 'bot') {
      const text = stripControls(event.text || '');
      if (event.kind === 'message') {
        return out(`${theme.pear('peer-bot')}${theme.gray(' \u276f ')}${text}\n`);
      }
      if (event.kind === 'reply') {
        return out(`${theme.pear('bot')}${theme.gray(' \u276f ')}${text}\n`);
      }
      return;
    }
  }

  function status(state = {}) {
    const role = stripControls(String(state.role ?? 'none'));
    const topic = state.topic ? `${stripControls(String(state.topic)).slice(0, 12)}\u2026` : 'none';
    const peerCount = Number.isSafeInteger(state.peerCount) ? state.peerCount : 0;
    const provider = stripControls(String(state.provider ?? 'none'));
    const model = stripControls(String(state.model ?? 'none'));
    const collaborative = state.collaborative ? ` ${theme.pear('collaborative')}` : '';
    out(`${theme.gray('\u00b7 ')}${theme.pear(`[${role}]`)} ${theme.gray('topic=')}${topic} ${theme.gray('peers=')}${peerCount} ${theme.gray('provider=')}${provider} ${theme.gray('model=')}${model}${collaborative}\n`);
  }

  return Object.freeze({
    banner,
    user,
    assistantStart,
    assistantChunk,
    assistantEnd,
    system,
    peer,
    ephemeral,
    harness,
    status,
    error
  });
}

export { stripControls, createRenderer };
