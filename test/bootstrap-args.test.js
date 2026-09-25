import test from 'brittle';
import { parseBootstrapArgs, DEFAULT_LOCAL_DHT_PORT, DEFAULT_OLLAMA_URL, DEFAULT_LMSTUDIO_URL } from '../js/p2p/bootstrap-args.js';

const defaults = { bootstrap: [], ollamaUrl: DEFAULT_OLLAMA_URL, lmstudioUrl: DEFAULT_LMSTUDIO_URL };

test('parseBootstrapArgs returns defaults for empty or non-array input', function (t) {
  t.alike(parseBootstrapArgs(undefined), defaults);
  t.alike(parseBootstrapArgs(null), defaults);
  t.alike(parseBootstrapArgs('nope'), defaults);
  t.alike(parseBootstrapArgs([]), defaults);
});

test('parseBootstrapArgs recognizes --local-dht with and without an explicit port', function (t) {
  t.alike(parseBootstrapArgs(['--local-dht']).bootstrap, [{ host: '127.0.0.1', port: DEFAULT_LOCAL_DHT_PORT }]);
  t.alike(parseBootstrapArgs(['--local-dht=40123']).bootstrap, [{ host: '127.0.0.1', port: 40123 }]);
});

test('parseBootstrapArgs recognizes --bootstrap=host:port entries', function (t) {
  t.alike(parseBootstrapArgs(['--bootstrap=127.0.0.1:5000']).bootstrap, [{ host: '127.0.0.1', port: 5000 }]);
  t.alike(
    parseBootstrapArgs(['--bootstrap=127.0.0.1:5001,10.0.0.2:5002']).bootstrap,
    [
      { host: '127.0.0.1', port: 5001 },
      { host: '10.0.0.2', port: 5002 }
    ]
  );
});

test('parseBootstrapArgs ignores malformed entries and deduplicates', function (t) {
  t.alike(parseBootstrapArgs(['--local-dht=abc', '--bootstrap=:1', '--bootstrap=127.0.0.1:99999']).bootstrap, []);
  t.alike(
    parseBootstrapArgs(['--local-dht=40001', '--local-dht=40001', '--bootstrap=127.0.0.1:40001']).bootstrap,
    [{ host: '127.0.0.1', port: 40001 }]
  );
});

test('parseBootstrapArgs skips non-string args', function (t) {
  t.alike(parseBootstrapArgs(['--local-dht=40001', 42, null, 'plain text']).bootstrap, [
    { host: '127.0.0.1', port: 40001 }
  ]);
});

test('parseBootstrapArgs resolves provider base URLs and normalizes them to origins', function (t) {
  const parsed = parseBootstrapArgs(['--ollama-url=http://10.0.0.5:11434/', '--lmstudio-url=http://10.0.0.6:1234/api/v0/models']);
  t.is(parsed.ollamaUrl, 'http://10.0.0.5:11434');
  t.is(parsed.lmstudioUrl, 'http://10.0.0.6:1234');
  const invalid = parseBootstrapArgs(['--ollama-url=ftp://nope', '--lmstudio-url=not a url']);
  t.is(invalid.ollamaUrl, DEFAULT_OLLAMA_URL);
  t.is(invalid.lmstudioUrl, DEFAULT_LMSTUDIO_URL);
});