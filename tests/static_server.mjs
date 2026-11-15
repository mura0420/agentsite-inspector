// A tiny static file server for tests. It serves one folder on 127.0.0.1 and can be
// told whether to send the CORS header, so the tests can check both cases.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, normalize, extname } from "node:path";

const TYPES = { ".json": "application/json", ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml" };

/**
 * Start a server for a folder.
 *
 * :param root: The folder to serve.
 * :param options: cors (default true) sends Access-Control-Allow-Origin: *.
 * :return: {url, close} with url ending in "/".
 */
export async function serveFolder(root, { cors = true } = {}) {
  const server = createServer(async (req, res) => {
    const path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^([/\\])+/, "");
    const file = join(root, path.endsWith("/") || path === "" ? join(path, "index.html") : path);
    if (!file.startsWith(root)) {
      res.writeHead(403).end();
      return;
    }
    try {
      const body = await readFile(file);
      const headers = { "content-type": TYPES[extname(file)] || "application/octet-stream" };
      if (cors) headers["access-control-allow-origin"] = "*";
      res.writeHead(200, headers).end(body);
    } catch {
      res.writeHead(404, cors ? { "access-control-allow-origin": "*" } : {}).end("not found");
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return { url: `http://127.0.0.1:${port}/`, close: () => new Promise((r) => server.close(r)) };
}
