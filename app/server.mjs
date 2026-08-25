import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const sourceFile = fileURLToPath(import.meta.url);
const root = path.resolve(path.dirname(sourceFile), "..");
const dist = path.join(root, "dist");
const contentSecurityPolicy = "default-src 'none'; base-uri 'none'; connect-src 'self'; font-src 'self'; form-action 'none'; frame-ancestors 'none'; img-src 'self' data:; object-src 'none'; script-src 'self'; style-src 'self'; worker-src 'self'";
const securityHeaders = Object.freeze({
  "content-security-policy": contentSecurityPolicy,
  "cross-origin-opener-policy": "same-origin",
  "cross-origin-resource-policy": "same-origin",
  "permissions-policy": "camera=(), geolocation=(), microphone=()",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY"
});
const allowedMethods = new Set(["GET", "HEAD"]);
const contentTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".map", "application/json; charset=utf-8"],
  [".txt", "text/plain; charset=utf-8"]
]);

function send(response, requestMethod, status, body = "", headers = {}) {
  response.writeHead(status, { ...securityHeaders, "cache-control": "no-store", ...headers });
  response.end(requestMethod === "HEAD" ? undefined : body);
}

export function createStaticHandler(rootDirectory = dist) {
  const staticRoot = path.resolve(rootDirectory);
  return (request, response) => {
    const method = request.method ?? "GET";
    if (!allowedMethods.has(method)) {
      send(response, method, 405, "Method not allowed\n", { allow: "GET, HEAD", "content-type": "text/plain; charset=utf-8" });
      return;
    }

    let pathname;
    try {
      pathname = decodeURIComponent(new URL(request.url ?? "/", "http://localhost").pathname);
    } catch {
      send(response, method, 400, "Bad request\n", { "content-type": "text/plain; charset=utf-8" });
      return;
    }
    if (pathname.includes("\0")) {
      send(response, method, 400, "Bad request\n", { "content-type": "text/plain; charset=utf-8" });
      return;
    }
    if (pathname === "/health") {
      send(response, method, 200, "ok\n", { "content-type": "text/plain; charset=utf-8" });
      return;
    }

    const requested = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
    const file = path.resolve(staticRoot, requested);
    if (!file.startsWith(`${staticRoot}${path.sep}`) && file !== path.join(staticRoot, "index.html")) {
      send(response, method, 404, "Not found\n", { "content-type": "text/plain; charset=utf-8" });
      return;
    }
    fs.readFile(file, (error, contents) => {
      if (error) {
        send(response, method, 404, "Not found\n", { "content-type": "text/plain; charset=utf-8" });
        return;
      }
      send(response, method, 200, contents, {
        "content-type": contentTypes.get(path.extname(file)) || "application/octet-stream"
      });
    });
  };
}

function configuredPort() {
  const value = Number(process.env.PORT || 8080);
  if (!Number.isInteger(value) || value < 1 || value > 65535) throw new Error("PORT must be an integer from 1 to 65535");
  return value;
}

async function start() {
  const watch = process.argv.includes("--watch");
  let builder;
  if (watch) {
    builder = spawn(process.execPath, [path.join(root, "app/build.mjs"), "--watch"], { stdio: "inherit" });
  } else if (!fs.existsSync(path.join(dist, "index.html"))) {
    throw new Error("dist/index.html is missing; run npm run build first");
  }

  const host = process.env.HOST || "127.0.0.1";
  const port = configuredPort();
  const server = http.createServer(createStaticHandler());
  server.listen(port, host, () => console.log(`GravityERD listening on http://${host}:${port}`));
  for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => {
    builder?.kill(signal);
    server.close(() => process.exit(0));
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === sourceFile) await start();
