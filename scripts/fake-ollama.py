#!/usr/bin/env python3
"""Fake Ollama/OpenAI provider for local SeekDeep harnesses.

Stdlib-only test fixture — not a product component. Stands in for a real
Ollama on 127.0.0.1 so `npm run native:e2e`, `npm run native:two-peer`, and
`npm run native:soak` work without a real Ollama install.

    python3 scripts/fake-ollama.py [port]    # default 11999

The streamed reply always contains the literal word `SeekDeep`, which
`scripts/e2e-worklet.mjs` asserts on (`[verify] STREAM_OK`).
"""

from __future__ import annotations

import json
import socket
import sys
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit

DEFAULT_PORT = 11999
MODEL = "fake-tiny:1b"
TOKENS = ("SeekDeep", " is", " streaming", " through", " the", " fake", " provider.")
# Long enough that chunks arrive as separate reads; short enough that a
# 150-turn soak does not spend all of its time sleeping.
TOKEN_DELAY_SECONDS = 0.01


class FakeOllamaHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "fake-ollama"
    sys_version = ""

    def setup(self) -> None:
        super().setup()
        # Streamed NDJSON is a burst of tiny writes; without TCP_NODELAY they
        # coalesce and the harness sees one dump instead of a stream.
        self.connection.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)

    def log_message(self, format: str, *args: object) -> None:
        """Suppress per-request logging; this fixture runs unattended."""

    def _read_body(self) -> None:
        length = self.headers.get("Content-Length")
        if not length:
            return
        try:
            self.rfile.read(int(length))
        except (ValueError, OSError):
            self.close_connection = True

    def _send_json(self, status: int, payload: dict) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _send_ndjson(self, lines: list[str]) -> None:
        self.send_response(200)
        self.send_header("Content-Type", "application/x-ndjson")
        self.send_header("Transfer-Encoding", "chunked")
        self.end_headers()
        try:
            for line in lines:
                payload = line.encode("utf-8") + b"\n"
                self.wfile.write(f"{len(payload):x}\r\n".encode("ascii"))
                self.wfile.write(payload)
                self.wfile.write(b"\r\n")
                self.wfile.flush()
                time.sleep(TOKEN_DELAY_SECONDS)
            self.wfile.write(b"0\r\n\r\n")
            self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError):
            self.close_connection = True

    def do_GET(self) -> None:
        path = urlsplit(self.path).path
        if path == "/api/tags":
            self._send_json(200, {"models": [{"name": MODEL, "model": MODEL}]})
        elif path == "/v1/models":
            self._send_json(200, {"data": [{"id": MODEL, "object": "model"}]})
        else:
            self._send_json(404, {"error": "not found", "path": path})

    def do_POST(self) -> None:
        path = urlsplit(self.path).path
        self._read_body()
        if self.close_connection:
            return
        if path == "/api/generate":
            lines = [
                json.dumps({"response": token, "done": False}, separators=(",", ":"))
                for token in TOKENS
            ]
            lines.append(json.dumps({"done": True, "done_reason": "stop"}, separators=(",", ":")))
            self._send_ndjson(lines)
        elif path == "/api/chat":
            lines = [
                json.dumps(
                    {"message": {"role": "assistant", "content": token}, "done": False},
                    separators=(",", ":"),
                )
                for token in TOKENS
            ]
            lines.append(
                json.dumps(
                    {
                        "message": {"role": "assistant", "content": ""},
                        "done": True,
                        "done_reason": "stop",
                    },
                    separators=(",", ":"),
                )
            )
            self._send_ndjson(lines)
        else:
            self._send_json(404, {"error": "not found", "path": path})


def main() -> None:
    raw_port = sys.argv[1] if len(sys.argv) > 1 else str(DEFAULT_PORT)
    try:
        port = int(raw_port)
    except ValueError:
        sys.exit(f"fake-ollama: port must be an integer, got {raw_port!r}")
    server = ThreadingHTTPServer(("127.0.0.1", port), FakeOllamaHandler)
    server.daemon_threads = True
    print(f"fake-ollama listening on http://127.0.0.1:{server.server_address[1]}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
