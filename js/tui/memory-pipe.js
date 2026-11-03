/**
 * Cross-wired in-memory duplex pair.
 *
 * Lets the worker backend and the RPC client run in the same Node process: a
 * write on one side is pushed into the peer, and `final()` closes the peer's
 * read side. Matches the `Pear.worker.pipe()` contract the RPC layer expects.
 */
import { Duplex } from 'node:stream';

function createMemoryPipePair() {
  let server;
  let client;
  server = new Duplex({
    read() {},
    write(chunk, _encoding, callback) { client.push(Buffer.from(chunk)); callback(); },
    final(callback) { client.push(null); callback(); }
  });
  client = new Duplex({
    read() {},
    write(chunk, _encoding, callback) { server.push(Buffer.from(chunk)); callback(); },
    final(callback) { server.push(null); callback(); }
  });
  return { server, client };
}

export { createMemoryPipePair };
