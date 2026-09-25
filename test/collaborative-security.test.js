/**
 * Tests for collaborative mode state and safe Markdown rendering.
 */
import test from 'brittle';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
global.window = dom.window;
global.document = dom.window.document;
global.NodeFilter = dom.window.NodeFilter;
global.CustomEvent = dom.window.CustomEvent;

const clientStateModule = await import('../js/session/client-state.js');
const formatting = await import('../js/messages/formatting.js');

test('collaborative mode is tracked from chat events', function (t) {
  const state = clientStateModule.createClientState();
  t.is(state.getState().collaborative, false, 'starts in private mode');

  let observed = null;
  state.subscribe((next) => { observed = next; });

  state.applyEvent({ type: 'mode', collaborative: true });
  t.is(state.getState().collaborative, true, 'collaborative mode can be enabled');
  t.is(observed.collaborative, true, 'subscribers are notified');

  state.applyEvent({ type: 'mode', collaborative: false });
  t.is(state.getState().collaborative, false, 'collaborative mode can be disabled');
});

test('renderMarkdown sanitizes dangerous peer/model HTML', function (t) {
  global.marked = {
    parse() {
      return '<p><a href="javascript:alert(1)">click</a></p><script>alert(1)</script><img src="x" onerror="alert(1)">';
    }
  };

  const rendered = formatting.renderMarkdown('**force markdown path**');

  t.absent(rendered.includes('<script'), 'script tags are removed');
  t.absent(rendered.includes('javascript:'), 'javascript URLs are removed');
  t.absent(rendered.includes('onerror'), 'inline event handlers are removed');
});

test('renderMarkdown escapes non-Markdown plain text', function (t) {
  const rendered = formatting.renderMarkdown('<img src=x onerror=alert(1)>');
  t.ok(rendered.includes('&lt;img'), 'plain HTML is escaped');
  t.absent(rendered.includes('<img'), 'plain HTML is not inserted as an element');
});

test('assistant thinking renders as a styled bubble, not literal HTML', function (t) {
  global.marked = {
    parse(text) {
      return `<p>${text}</p>`;
    }
  };

  const rendered = formatting.renderAssistantContent(
    '<think>The user greeted me.</think>Hello! How can I help?'
  );

  t.ok(rendered.includes('<div class="thinking-content">'), 'thinking wrapper renders as HTML');
  t.ok(rendered.includes('<span class="thinking-label">Thinking:</span>'), 'thinking label renders as HTML');
  t.absent(rendered.includes('&lt;div class="thinking-content"'), 'thinking wrapper is not escaped');
  t.ok(rendered.includes('Hello! How can I help?'), 'final answer remains visible');
});
