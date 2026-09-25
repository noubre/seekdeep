import test from 'brittle';
import { parseBootstrapArgs, DEFAULT_LOCAL_DHT_PORT } from '../js/network/bootstrap-args.js';

test('parseBootstrapArgs returns an empty list for empty or non-array input', function (t) {
  t.alike(parseBootstrapArgs(undefined), []);
  t.alike(parseBootstrapArgs(null), []);
  t.alike(parseBootstrapArgs('nope'), []);
  t.alike(parseBootstrapArgs([]), []);
});

test('parseBootstrapArgs recognizes --local-dht with and without an explicit port', function (t) {
  t.alike(parseBootstrapArgs(['--local-dht']), [{ host: '127.0.0.1', port: DEFAULT_LOCAL_DHT_PORT }]);
  t.alike(parseBootstrapArgs(['--local-dht=40123']), [{ host: '127.0.0.1', port: 40123 }]);
});

test('parseBootstrapArgs recognizes --bootstrap=host:port entries', function (t) {
  t.alike(parseBootstrapArgs(['--bootstrap=127.0.0.1:5000']), [{ host: '127.0.0.1', port: 5000 }]);
  t.alike(
    parseBootstrapArgs(['--bootstrap=127.0.0.1:5001,10.0.0.2:5002']),
    [
      { host: '127.0.0.1', port: 5001 },
      { host: '10.0.0.2', port: 5002 }
    ]
  );
});

test('parseBootstrapArgs ignores malformed entries and deduplicates', function (t) {
  t.alike(parseBootstrapArgs(['--local-dht=abc', '--bootstrap=:1', '--bootstrap=127.0.0.1:99999']), []);
  t.alike(
    parseBootstrapArgs(['--local-dht=40001', '--local-dht=40001', '--bootstrap=127.0.0.1:40001']),
    [{ host: '127.0.0.1', port: 40001 }]
  );
});

test('parseBootstrapArgs skips non-string args', function (t) {
  t.alike(parseBootstrapArgs(['--local-dht=40001', 42, null, 'plain text']), [
    { host: '127.0.0.1', port: 40001 }
  ]);
});
