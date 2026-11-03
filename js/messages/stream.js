/**
 * Shared assistant-stream mutator for the GUI and TUI renderers.
 *
 * Pure store work: no DOM, no bare-module imports, so the renderer import graph
 * stays free of worker/Node-only dependencies.
 */
import { addMessage, findLastMessageByRequestId } from './store.js';

/**
 * Append a streamed chunk to the assistant message for `requestId`, creating
 * the message on first sight and marking it complete on `done`.
 * @param {{ requestId?: string, chunk?: string, done?: boolean }} event - Stream event
 * @returns {Object} The mutated message
 */
function applyAssistantChunk({ requestId, chunk, done }) {
  let message = findLastMessageByRequestId(requestId, 'assistant');
  if (!message) message = addMessage({ type: 'assistant', content: '', rawContent: '', requestId });
  if (chunk) {
    message.rawContent = (message.rawContent || '') + chunk;
    message.content = message.rawContent;
  }
  if (done) message.isComplete = true;
  return message;
}

export { applyAssistantChunk };
