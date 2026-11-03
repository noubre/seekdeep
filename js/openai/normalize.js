/**
 * Shared primitives for the OpenAI/Anthropic codecs: id/time helpers, the common
 * JSON writer, tool/stop normalisation, and the cancellation plumbing used by
 * every writer. Pure: the only I/O is the `res` handed in.
 */
import { createSseStream } from './sse.js';

function randomId() {
  return Math.random().toString(36).slice(2, 12);
}

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

function writeJson(res, status, payload) {
  if (res.writableEnded) return;
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(payload));
}

// `mapTool` returns the normalized `{ name, description, parametersJson }` entry
// or null to drop the tool; non-objects never reach it.
function normalizeToolList(rawTools, mapTool) {
  if (!Array.isArray(rawTools)) return [];
  const result = [];
  for (const tool of rawTools) {
    if (!tool || typeof tool !== 'object') continue;
    const mapped = mapTool(tool);
    if (mapped) result.push(mapped);
  }
  return result;
}

function normalizeStopList(stop, { allowString = false } = {}) {
  if (allowString && typeof stop === 'string') return stop ? [stop] : [];
  if (Array.isArray(stop)) return stop.filter((entry) => typeof entry === 'string' && entry);
  return [];
}

// Shared cancellation/error plumbing for every writer.
function createWriterBase({ res, stream }) {
  const sse = stream ? createSseStream(res) : null;
  let aborted = false;

  return {
    sse,
    get aborted() { return aborted; },
    writeJson(status, payload) { writeJson(res, status, payload); },
    end() {
      if (sse) {
        try { sse.end(); } catch { /* never throw on abort */ }
      }
    },
    abort() {
      aborted = true;
      if (sse && sse.started) {
        try { sse.end(); } catch { /* never throw on abort */ }
      }
    }
  };
}

export { randomId, nowSeconds, writeJson, normalizeToolList, normalizeStopList, createWriterBase };
