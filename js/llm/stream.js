/**
 * Shared streaming plumbing for the HTTP provider adapters (Ollama, LM Studio).
 *
 * Pure: no DOM, no chat history, no UI imports, no node builtins — the Bare
 * worker imports this module. Owns the fetch/base-URL resolution, the
 * newline-delimited read loop, the tool-call accumulator, and the normalized
 * response assembly.
 */
import { normalizeFinishReason, nextToolCallId } from './chat-types.js';

/**
 * Resolve the fetch implementation used by a provider.
 * @param {string} providerLabel
 * @param {Function} [fetchImpl]
 * @returns {Function}
 */
function resolveFetch(providerLabel, fetchImpl) {
  const resolved = fetchImpl || globalThis.fetch;
  if (typeof resolved !== 'function') throw new TypeError(`${providerLabel} provider requires a fetch implementation`);
  return resolved;
}

/**
 * Resolve a base URL, falling back to the provider default.
 * @param {string|URL} [baseUrl]
 * @param {string} defaultBaseUrl
 * @returns {URL}
 */
function resolveBaseUrl(baseUrl, defaultBaseUrl) {
  return new URL(baseUrl || defaultBaseUrl);
}

/**
 * Read a response body and feed each newline-delimited line to `consumeLine`,
 * then flush the trailing remainder. Throws when the response carries no body.
 * @param {Response} response
 * @param {(line: string) => void} consumeLine
 * @param {string} label e.g. `Ollama ask`
 */
async function readDecodedLines(response, consumeLine, label) {
  if (!response.body) throw new Error(`${label} returned no stream body`);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let newline;
    while ((newline = buffer.indexOf('\n')) !== -1) {
      consumeLine(buffer.slice(0, newline));
      buffer = buffer.slice(newline + 1);
    }
  }
  buffer += decoder.decode();
  if (buffer) consumeLine(buffer);
}

/**
 * Accumulate streamed tool-call deltas keyed by `index`.
 *
 * Create-on-first-sight at `index`; `id` is last-wins with a synthesized
 * fallback; `name` is last-wins; `argumentsJson` concatenates every delta.
 * @returns {{ upsert: (delta: { index: number, id?: string, name?: string, argumentsDelta?: string }) => object, toArray: () => Array<object> }}
 */
function createToolCallAccumulator() {
  const calls = new Map();
  const order = [];

  function upsert({ index, id, name, argumentsDelta }) {
    let call = calls.get(index);
    if (!call) {
      call = { index, id: id ?? nextToolCallId(), name: undefined, argumentsJson: '' };
      calls.set(index, call);
      order.push(index);
    } else if (id) {
      call.id = id;
    }
    if (typeof name === 'string' && name) call.name = name;
    if (typeof argumentsDelta === 'string' && argumentsDelta) call.argumentsJson += argumentsDelta;
    return call;
  }

  function toArray() {
    return order.map((index) => {
      const call = calls.get(index);
      return { index: call.index, id: call.id, name: call.name, argumentsJson: call.argumentsJson };
    });
  }

  return { upsert, toArray };
}

/**
 * Assemble the normalized chat result from streamed state.
 * @param {{ text: string, reasoning: string, accumulator: object, finishReason?: unknown, promptTokens?: number, completionTokens?: number }} state
 * @returns {{ text: string, reasoning: string, toolCalls: Array<object>, finishReason: string, usage: object }}
 */
function finalizeStream({ text, reasoning, accumulator, finishReason, promptTokens, completionTokens }) {
  const toolCalls = accumulator.toArray();
  const usage = {};
  if (promptTokens !== undefined) usage.promptTokens = promptTokens;
  if (completionTokens !== undefined) usage.completionTokens = completionTokens;
  return { text, reasoning, toolCalls, finishReason: normalizeFinishReason(finishReason, toolCalls.length > 0), usage };
}

export { resolveFetch, resolveBaseUrl, readDecodedLines, createToolCallAccumulator, finalizeStream };
