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
import { splitThinking } from '../messages/thinking.js';

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

  const SPINNER = ['\u280b', '\u2819', '\u2839', '\u2838', '\u283c', '\u2834', '\u2826', '\u2827', '\u2807', '\u280f'];
  const FRAME_MS = 120;

  let streaming = false;
  let raw = '';
  let shown = 0;
  let thinking = false;
  let frame = 0;
  let timer = null;
  let partial = '';           // raw text of the in-progress answer line
  let partialRows = 0;        // terminal rows it occupies
  let partialWritten = false; // was the partial actually written to the screen?
  let prefixPending = true;   // the "ai ❯ " prefix has not been emitted yet
  let prefixShown = false;    // the prefix is currently on screen (on the partial row)
  let lineOpen = false;       // something is written on the current row, unterminated
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
    prefixShown = false;
    lineOpen = true;
  }

  function showThinking() {
    if (prefixPending) {
      out(prefix);
      prefixPending = false;
      prefixShown = true;
    }
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

  function clearThinking() {
    stopTimer();
    if (animate) out('\r\x1b[K');
    else out('\n');
    prefixShown = false;
    lineOpen = false;
  }

  // Stream the in-progress line (interactive only), emitting the prefix lazily.
  function writePartial(text) {
    if (interactive) {
      if (prefixPending) {
        out(prefix);
        prefixPending = false;
        prefixShown = true;
      }
      out(text);
      partial += text;
      const base = prefixShown ? 4 : 0; // 4 = visible width of "ai ❯ "
      partialRows = Math.max(1, Math.ceil((base + partial.length) / columns));
      partialWritten = true;
      lineOpen = true;
    } else {
      partial += text; // hold back until the line completes
    }
  }

  // Render one completed answer line: erase any streamed partial, then write the
  // markdown-rendered line. The prefix is written at most once per message and
  // is restored only on the line that carried it.
  function finishLine(text) {
    if (interactive && partialWritten) {
      const up = partialRows > 1 ? `\x1b[${partialRows - 1}A` : '';
      out(`${up}\r\x1b[J`);
    }
    const restorePrefix = prefixShown;
    partial = '';
    partialRows = 0;
    partialWritten = false;
    prefixShown = false;

    const rendered = markdown.writeLine(text);
    if (prefixPending && rendered === '') return; // drop leading blank lines
    if (restorePrefix || prefixPending) {
      out(prefix);
      prefixPending = false;
    }
    out(rendered + '\n');
    lineOpen = false;
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
    partialWritten = false;
    prefixPending = true;
    prefixShown = false;
    lineOpen = false;
    markdown.reset();
  }

  function assistantChunk(text) {
    raw += stripControls(text);
    const { answer, open } = splitThinking(raw);
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
      prefixPending = true; // the answer gets its own prefix after the indicator
    }
    if (answer.length <= shown) return;
    let delta = answer.slice(shown);
    shown = answer.length;

    let nl;
    while ((nl = delta.indexOf('\n')) !== -1) {
      finishLine(partial + delta.slice(0, nl));
      delta = delta.slice(nl + 1);
    }
    if (delta) writePartial(delta);
  }

  function assistantEnd() {
    if (!streaming) return;
    streaming = false;
    stopTimer();
    thinking = false;
    if (partial) finishLine(partial);
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
