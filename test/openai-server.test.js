import test from 'brittle';
import http from 'node:http';
import { createHttpServer } from '../js/openai/http-server.js';

function makeBackend({ onComplete } = {}) {
  return {
    listModels: async () => [{ id: 'stub:1', name: 'Stub 1' }],
    complete: (request, sink) => {
      if (onComplete) return onComplete(request, sink) || (() => {});
      sink.text('ok');
      sink.done({ finishReason: 'stop', usage: { promptTokens: 1, completionTokens: 1 } });
      return () => {};
    }
  };
}

async function start(backend = makeBackend(), apiKey = null) {
  return createHttpServer({ backend, http, host: '127.0.0.1', port: 0, apiKey, log: () => {} });
}

test('GET /models lists the backend models', async function (t) {
  const server = await start();
  t.teardown(() => server.close());
  const response = await fetch(`${server.url}/v1/models`);
  t.is(response.status, 200);
  const body = await response.json();
  t.is(body.object, 'list');
  t.is(body.data[0].id, 'stub:1');
  t.is(body.data[0].object, 'model');
  t.is(body.data[0].owned_by, 'seekdeep');

  const bare = await fetch(`${server.url}/models`);
  t.is((await bare.json()).data[0].id, 'stub:1');
});

test('chat completions works on both /v1 and bare base URLs', async function (t) {
  const server = await start();
  t.teardown(() => server.close());
  const payload = JSON.stringify({ model: 'stub:1', messages: [{ role: 'user', content: 'hi' }], stream: false });

  for (const path of ['/v1/chat/completions', '/chat/completions']) {
    const response = await fetch(`${server.url}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload });
    t.is(response.status, 200, path);
    const body = await response.json();
    t.is(body.object, 'chat.completion');
    t.is(body.choices[0].message.content, 'ok');
    t.is(body.choices[0].finish_reason, 'stop');
  }
});

test('streaming chat completions ends with [DONE]', async function (t) {
  const server = await start();
  t.teardown(() => server.close());
  const response = await fetch(`${server.url}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'stub:1', messages: [{ role: 'user', content: 'hi' }], stream: true })
  });
  t.is(response.status, 200);
  t.is(response.headers.get('content-type'), 'text/event-stream');
  const text = await response.text();
  t.ok(text.includes('"object":"chat.completion.chunk"'));
  t.ok(text.endsWith('data: [DONE]\n\n'));
});

test('malformed JSON and missing messages return 400', async function (t) {
  const server = await start();
  t.teardown(() => server.close());
  const bad = await fetch(`${server.url}/v1/chat/completions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{not json' });
  t.is(bad.status, 400);
  t.is((await bad.json()).error.type, 'invalid_request_error');

  const missing = await fetch(`${server.url}/v1/chat/completions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: 'stub:1' }) });
  t.is(missing.status, 400);
});

test('unknown paths 404, wrong methods 405, OPTIONS 204', async function (t) {
  const server = await start();
  t.teardown(() => server.close());

  const notFound = await fetch(`${server.url}/v1/nope`);
  t.is(notFound.status, 404);
  t.is((await notFound.json()).error.code, 'not_found');

  const wrongMethod = await fetch(`${server.url}/v1/chat/completions`);
  t.is(wrongMethod.status, 405);

  const options = await fetch(`${server.url}/v1/chat/completions`, { method: 'OPTIONS' });
  t.is(options.status, 204);
  t.is(options.headers.get('access-control-allow-origin'), '*');
});

test('oversize bodies return 413', async function (t) {
  const server = await start();
  t.teardown(() => server.close());
  const response = await fetch(`${server.url}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'stub:1', messages: [{ role: 'user', content: 'x'.repeat(9 * 1024 * 1024) }] })
  }).catch(() => null);
  // The server destroys the socket after the cap; either a 413 or a transport error is acceptable.
  if (response) t.is(response.status, 413);
  t.pass();
});

test('count_tokens returns an input_tokens number', async function (t) {
  const server = await start();
  t.teardown(() => server.close());
  const response = await fetch(`${server.url}/v1/messages/count_tokens`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'stub:1', max_tokens: 16, messages: [{ role: 'user', content: 'hello there' }] })
  });
  t.is(response.status, 200);
  const body = await response.json();
  t.ok(Number.isSafeInteger(body.input_tokens) && body.input_tokens >= 1);
});

test('auth is enforced only when an api key is configured', async function (t) {
  const noKey = await start(makeBackend(), null);
  t.teardown(() => noKey.close());
  const open = await fetch(`${noKey.url}/v1/models`);
  t.is(open.status, 200);

  const guarded = await start(makeBackend(), 'sk-test');
  t.teardown(() => guarded.close());

  const anonymous = await fetch(`${guarded.url}/v1/models`);
  t.is(anonymous.status, 401);
  t.is((await anonymous.json()).error.code, 'invalid_api_key');

  const wrong = await fetch(`${guarded.url}/v1/models`, { headers: { Authorization: 'Bearer nope' } });
  t.is(wrong.status, 401);

  const bearer = await fetch(`${guarded.url}/v1/models`, { headers: { Authorization: 'Bearer sk-test' } });
  t.is(bearer.status, 200);

  const header = await fetch(`${guarded.url}/v1/models`, { headers: { 'x-api-key': 'sk-test' } });
  t.is(header.status, 200);
});

test('backend completion failures surface as the format error event', async function (t) {
  const backend = makeBackend({
    onComplete(request, sink) {
      sink.text('partial');
      sink.error(new Error('host provider exploded'));
      return () => {};
    }
  });
  const server = await start(backend);
  t.teardown(() => server.close());
  const response = await fetch(`${server.url}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'stub:1', messages: [{ role: 'user', content: 'hi' }], stream: true })
  });
  const text = await response.text();
  t.ok(text.includes('event: error'));
  t.ok(text.includes('host provider exploded'));
});

