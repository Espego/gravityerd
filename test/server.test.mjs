import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createStaticHandler } from "../app/server.mjs";

function request(handler, requestPath, method = "GET") {
  return new Promise((resolve, reject) => {
    const response = {
      status: null,
      headers: null,
      writeHead(status, headers) {
        this.status = status;
        this.headers = headers;
      },
      end(body) {
        resolve({ status: this.status, headers: this.headers, body: body == null ? "" : Buffer.from(body).toString("utf8") });
      }
    };
    try { handler({ method, url: requestPath }, response); } catch (error) { reject(error); }
  });
}

test("static server applies security headers and rejects unsafe requests", async (context) => {
  const directory = await mkdtemp(path.join(tmpdir(), "gravityerd-server-"));
  const handler = createStaticHandler(directory);
  context.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(path.join(directory, "index.html"), "<!doctype html><title>GravityERD</title>\n");

  const root = await request(handler, "/");
  assert.equal(root.status, 200);
  assert.match(root.headers["content-security-policy"], /default-src 'none'/u);
  assert.equal(root.headers["x-content-type-options"], "nosniff");
  assert.equal(root.headers["x-frame-options"], "DENY");
  assert.equal(root.headers["cross-origin-opener-policy"], "same-origin");
  assert.equal(root.headers["referrer-policy"], "no-referrer");

  const head = await request(handler, "/", "HEAD");
  assert.equal(head.status, 200);
  assert.equal(head.body, "");
  const method = await request(handler, "/", "POST");
  assert.equal(method.status, 405);
  assert.equal(method.headers.allow, "GET, HEAD");
  assert.equal((await request(handler, "/%2e%2e%2fpackage.json")).status, 404);
  assert.equal((await request(handler, "/%ZZ")).status, 400);
  assert.equal((await request(handler, "/health")).body, "ok\n");
});
