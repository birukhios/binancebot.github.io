import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(fileURLToPath(new URL("..", import.meta.url)));
const clientDir = join(rootDir, "dist", "client");
const serverEntry = await import("../dist/server/server.js");
const handler = serverEntry.default?.fetch ?? serverEntry.fetch;

if (typeof handler !== "function") {
  throw new Error("Render server could not find the built TanStack Start fetch handler.");
}

const mimeByExt = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".map", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".svg", "image/svg+xml"],
  [".webp", "image/webp"],
  [".ico", "image/x-icon"],
]);

function toNodeHeaders(headers) {
  const out = {};
  headers.forEach((value, key) => {
    out[key] = value;
  });
  return out;
}

function staticPath(url) {
  const pathname = decodeURIComponent(new URL(url, "http://render.local").pathname);
  const normalized = normalize(pathname).replace(/^(\.\.(\/|\\|$))+/, "");
  const filePath = join(clientDir, normalized === sep ? "index.html" : normalized);
  if (!filePath.startsWith(clientDir)) return null;
  return filePath;
}

async function serveStatic(req, res) {
  const filePath = staticPath(req.url ?? "/");
  if (!filePath) return false;

  try {
    const info = await stat(filePath);
    if (!info.isFile()) return false;
    res.writeHead(200, {
      "content-length": info.size,
      "content-type": mimeByExt.get(extname(filePath)) ?? "application/octet-stream",
      "cache-control": filePath.includes(`${sep}assets${sep}`)
        ? "public, max-age=31536000, immutable"
        : "no-cache",
    });
    if (req.method === "HEAD") {
      res.end();
      return true;
    }
    createReadStream(filePath).pipe(res);
    return true;
  } catch {
    return false;
  }
}

async function toWebRequest(req) {
  const host = req.headers.host ?? `0.0.0.0:${process.env.PORT ?? "3000"}`;
  const url = new URL(req.url ?? "/", `http://${host}`);
  const init = {
    method: req.method,
    headers: req.headers,
    body: req.method === "GET" || req.method === "HEAD" ? undefined : req,
    duplex: "half",
  };
  return new Request(url, init);
}

const server = createServer(async (req, res) => {
  try {
    if (await serveStatic(req, res)) return;

    const response = await handler(await toWebRequest(req), {}, {});
    res.writeHead(response.status, toNodeHeaders(response.headers));
    if (req.method === "HEAD" || !response.body) {
      res.end();
      return;
    }
    const reader = response.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(value);
    }
    res.end();
  } catch (error) {
    console.error(error);
    res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
    res.end("Internal Server Error");
  }
});

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? "0.0.0.0";

server.listen(port, host, () => {
  console.log(`Render server listening on http://${host}:${port}`);
});
