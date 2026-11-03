import test from 'brittle';
import { parseHttpArgs, DEFAULT_HTTP_PORT, DEFAULT_HTTP_HOST } from '../js/openai/args.js';

test('parseHttpArgs applies defaults', async function (t) {
  t.alike(parseHttpArgs([]), { http: true, httpPort: DEFAULT_HTTP_PORT, httpHost: DEFAULT_HTTP_HOST, apiKey: null, model: null, topic: null });
  t.alike(parseHttpArgs(undefined), { http: true, httpPort: DEFAULT_HTTP_PORT, httpHost: DEFAULT_HTTP_HOST, apiKey: null, model: null, topic: null });
});

test('parseHttpArgs reads each flag', async function (t) {
  const config = parseHttpArgs([
    '--http-port=9000', '--http-host=0.0.0.0', '--api-key=sk-test',
    '--model=llama3.1', '--topic=' + 'a'.repeat(64)
  ]);
  t.is(config.httpPort, 9000);
  t.is(config.httpHost, '0.0.0.0');
  t.is(config.apiKey, 'sk-test');
  t.is(config.model, 'llama3.1');
  t.is(config.topic, 'a'.repeat(64));
});

test('parseHttpArgs ignores invalid values and lets --no-http win', async function (t) {
  const config = parseHttpArgs(['--http-port=0', '--http-port=70000', '--http-host=', '--api-key=', '--model=', '--no-http']);
  t.is(config.http, false);
  t.is(config.httpPort, DEFAULT_HTTP_PORT);
  t.is(config.httpHost, DEFAULT_HTTP_HOST);
  t.is(config.apiKey, null);
  t.is(config.model, null);
});