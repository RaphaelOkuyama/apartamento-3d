"""Receives the model from the open page once and saves it for Blender. Binds to this computer only."""
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer

target = sys.argv[1]


class Handler(BaseHTTPRequestHandler):
    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "http://localhost:8770")

    def do_POST(self):
        body = self.rfile.read(int(self.headers["Content-Length"]))
        with open(target, "wb") as f:
            f.write(body)
        self.send_response(200)
        self._cors()
        self.end_headers()
        print(f"saved {len(body)} bytes", flush=True)
        self.server.done = True


server = HTTPServer(("127.0.0.1", 8771), Handler)
server.done = False
while not server.done:
    server.handle_request()
