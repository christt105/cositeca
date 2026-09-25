import argparse
import http.server

MAX_BODY = 5 * 1024 * 1024


class Handler(http.server.SimpleHTTPRequestHandler):
    def do_POST(self):
        targets = {"/save-corrections": "corrections.csv", "/save-state": "state.json"}
        if self.path not in targets:
            self.send_error(404)
            return
        length = int(self.headers.get("Content-Length", 0))
        if length > MAX_BODY:
            self.send_error(413)
            return
        body = self.rfile.read(length)
        with open(f"{self.directory}/{targets[self.path]}", "wb") as f:
            f.write(body)
        self.send_response(200)
        self.send_header("Content-Type", "text/plain")
        self.end_headers()
        self.wfile.write(b"ok")

    def log_message(self, fmt, *args):
        if args and "/save-" in str(args[0]):
            print(f"saved {args[0]} ({self.headers.get('Content-Length')} bytes)")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--dir", default="cache")
    args = parser.parse_args()

    def handler(*a, **kw):
        return Handler(*a, directory=args.dir, **kw)

    http.server.ThreadingHTTPServer((args.host, args.port), handler).serve_forever()


if __name__ == "__main__":
    main()
