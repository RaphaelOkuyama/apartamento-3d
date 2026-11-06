"""Serves site/ on this computer only, with caching off so every reload picks up edits."""
import functools
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


class NoCache(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


site = Path(__file__).resolve().parent.parent / "site"
port = int(sys.argv[1]) if len(sys.argv) > 1 else 8770
ThreadingHTTPServer(("127.0.0.1", port), functools.partial(NoCache, directory=str(site))).serve_forever()
