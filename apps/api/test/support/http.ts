import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import type { Express } from "express";
import supertest from "supertest";
import { afterAll, afterEach } from "vitest";

// supertest, with the app reached through a server that listens on 127.0.0.1 only.
//
// Given an app, supertest listens on "any address, any free port" and then calls
// 127.0.0.1:<port>. macOS will hand out a port that another program already holds on 127.0.0.1
// specifically — editors and their extensions do — and that program, not the app, then answers
// the test. It showed up as about one failed run in twenty: a 401 in somebody else's format, a
// 426 from a WebSocket server, a request that never returned. A port asked for on 127.0.0.1
// itself cannot clash that way.
//
// The server has to be listening before supertest first looks at it — listen() with a host
// completes a tick later, and supertest, finding no address yet, would start its own listener
// on every address again. So there is one server per test file, awaited here at import, and each
// request names the app it is for.

const APP_HEADER = "x-test-app";
const apps = new Map<string, Express>();

const server = createServer((req, res) => {
  const app = apps.get(String(req.headers[APP_HEADER]));
  if (app) return void app(req, res);
  res.statusCode = 500;
  res.end("test/support/http.ts: this request named no app, or one from a test that has finished");
});
await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));

afterEach(() => apps.clear());
afterAll(() => {
  server.closeAllConnections();
  server.close();
});

function clientFor(app: Express) {
  const id = randomUUID();
  apps.set(id, app);
  return supertest.agent(server).set(APP_HEADER, id);
}

/** `request(app)` for one-off requests; `request.agent(app)` keeps cookies between requests, like a browser. */
export const request = Object.assign(clientFor, { agent: clientFor });
