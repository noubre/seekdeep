/**
 * Ollama sends a *complete* `tool_calls` object per chunk. The accumulator in
 * js/llm/stream.js concatenates argument fragments because OpenAI streams them that way;
 * feeding it complete objects produced `{"city":"SF"}{"city":"SF"}` — invalid JSON that
 * later fails validateToolCall when the client sends the history back.
 */
import test from 'brittle';
import http from 'node:http';
import { createOllama } from '../js/llm/ollama.js';

function startServer(lines) {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
    for (const line of lines) res.write(`${JSON.stringify(line)}\n`);
    res.end(`${JSON.stringify({ done: true, done_reason: 'tool_calls' })}\n`);
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, baseUrl: `http://127.0.0.1:${server.address().port}` }));
  });
}

test('repeated Ollama tool_call chunks stay one valid JSON object', async function (t) {
  const call = { message: { tool_calls: [{ function: { name: 'get_weather', arguments: { city: 'SF' } } }] } };
  const { server, baseUrl } = await startServer([call, call]);
  t.teardown(() => server.close());

  const result = await createOllama({ baseUrl, fetch: globalThis.fetch })
    .chat('llama3', { messages: [{ role: 'user', content: 'weather?' }] });

  t.is(result.toolCalls.length, 1, 'one call, not two');
  t.is(result.toolCalls[0].name, 'get_weather');
  t.is(result.toolCalls[0].argumentsJson, '{"city":"SF"}');
  t.comment(`argumentsJson=${result.toolCalls[0].argumentsJson}`);
});
