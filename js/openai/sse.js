/**
 * Minimal Server-Sent Events writer for the OpenAI/Anthropic surface.
 *
 * The response head is written lazily on the first write so a request that
 * fails validation can still answer with a plain JSON error and a real status.
 */

function createSseStream(res) {
  let started = false;
  let ended = false;

  function ensureHead() {
    if (started) return;
    started = true;
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
      'Access-Control-Allow-Origin': '*'
    });
  }

  function write(text) {
    if (ended || res.writableEnded) return;
    ensureHead();
    res.write(text);
  }

  return {
    event(name, data) { write(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`); },
    data(data) { write(`data: ${JSON.stringify(data)}\n\n`); },
    raw(line) { write(`data: ${line}\n\n`); },
    end() {
      if (ended) return;
      ended = true;
      if (res.writableEnded) return;
      ensureHead();
      res.end();
    },
    get started() { return started; }
  };
}

export { createSseStream };