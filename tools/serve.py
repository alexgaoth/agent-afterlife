#!/usr/bin/env python3
"""Serve the site locally, optionally with your own data file.

  python3 tools/serve.py                 the demo fleet
  python3 tools/serve.py my-fleet.json   your data, at /data.json, opened with ?data=data.json

Browsers do not run ES modules from file:// pages, so a small server is needed.
"""
import functools
import http.server
import os
import sys
import webbrowser

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.abspath(sys.argv[1]) if len(sys.argv) > 1 else None
PORT = int(os.environ.get("PORT", "8123"))


class Handler(http.server.SimpleHTTPRequestHandler):
    def translate_path(self, path):
        if DATA and path.split("?")[0] == "/data.json":
            return DATA
        return super().translate_path(path)

    def log_message(self, *args):
        pass


if __name__ == "__main__":
    url = f"http://localhost:{PORT}/" + ("?data=data.json" if DATA else "")
    print(f"Serving {ROOT} at {url}  (Ctrl-C to stop)")
    httpd = http.server.ThreadingHTTPServer(("127.0.0.1", PORT), functools.partial(Handler, directory=ROOT))
    if os.environ.get("NO_BROWSER") != "1":
        webbrowser.open(url)
    httpd.serve_forever()
