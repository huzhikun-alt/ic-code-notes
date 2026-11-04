#!/usr/bin/env python3
"""带实时刷新的本地开发服务。

访问 http://127.0.0.1:8720/ ，任何文件改动后页面自动重载。
只用于开发预览：正式包仍用 start.cmd。
"""
import os
import sys
import time
import hashlib
import threading
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler

ROOT = os.path.dirname(os.path.abspath(__file__))
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8720
WATCH_EXT = ('.html', '.css', '.js', '.svg', '.json', '.md')

LIVE_JS = r"""
(function () {
  var last = null;
  function tick() {
    fetch('/__rev', { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (last === null) { last = d.rev; return; }
        if (d.rev !== last) { location.reload(); }
      })
      .catch(function () {});
  }
  setInterval(tick, 1200);
  tick();
})();
"""


def revision():
    h = hashlib.md5()
    for base, dirs, files in os.walk(ROOT):
        dirs[:] = [d for d in dirs if not d.startswith('.') and d not in ('node_modules', '__pycache__')]
        for name in sorted(files):
            if not name.endswith(WATCH_EXT):
                continue
            path = os.path.join(base, name)
            try:
                st = os.stat(path)
            except OSError:
                continue
            h.update(name.encode('utf-8', 'ignore'))
            h.update(str(st.st_mtime_ns).encode())
            h.update(str(st.st_size).encode())
    return h.hexdigest()[:12]


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    def log_message(self, fmt, *args):
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))

    def _send(self, body, ctype):
        if isinstance(body, str):
            body = body.encode('utf-8')
        self.send_response(200)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate')
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        path = self.path.split('?')[0]

        if path == '/__rev':
            self._send('{"rev":"%s"}' % revision(), 'application/json; charset=utf-8')
            return

        if path == '/__live.js':
            self._send(LIVE_JS, 'application/javascript; charset=utf-8')
            return

        if path in ('/', '/index.html'):
            file_path = os.path.join(ROOT, 'index.html')
            try:
                with open(file_path, 'r', encoding='utf-8') as f:
                    html = f.read()
            except OSError:
                self.send_error(404, 'index.html not found')
                return
            if '__live.js' not in html:
                tag = '<script src="/__live.js"></script>'
                if '</body>' in html:
                    html = html.replace('</body>', tag + '\n</body>', 1)
                else:
                    html += tag
            self._send(html, 'text/html; charset=utf-8')
            return

        return super().do_GET()


def main():
    server = ThreadingHTTPServer(('127.0.0.1', PORT), Handler)
    print('IC notes dev server')
    print('  http://127.0.0.1:%d/' % PORT)
    print('  live reload: on (1.2s poll)')
    print('  root: %s' % ROOT)
    print('  Ctrl+C to stop')
    sys.stdout.flush()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == '__main__':
    main()
