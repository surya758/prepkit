import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { USER_AGENT, fetchPage } from "../src";
import type { FetchPageOptions } from "../src";

// A real HTTP server on a random port, like the localhost fixture sites the brief describes.
type Handler = (req: IncomingMessage, res: ServerResponse) => void;
const routes = new Map<string, Handler>();
const hits = new Map<string, number>();
let server: Server;
let base: string;

const html = (body: string): Handler => (_req, res) => {
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(body);
};

beforeAll(async () => {
  server = createServer((req, res) => {
    const path = req.url ?? "/";
    hits.set(path, (hits.get(path) ?? 0) + 1);
    const handler = routes.get(path);
    if (handler) return handler(req, res);
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("not found");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
});

beforeEach(() => {
  routes.clear();
  hits.clear();
});

const sleep = vi.fn(async () => {});
const local = (extra: Partial<FetchPageOptions> = {}): FetchPageOptions => ({
  allowPrivateHosts: true,
  sleep,
  ...extra,
});

describe("fetchPage — success", () => {
  it("returns the body, final URL and content type, and identifies itself", async () => {
    let userAgent: string | undefined;
    routes.set("/acme/", (req, res) => {
      userAgent = req.headers["user-agent"];
      html("<h1>Acme</h1>")(req, res);
    });

    const result = await fetchPage(`${base}/acme/`, local());
    expect(result).toMatchObject({
      ok: true,
      url: `${base}/acme/`,
      status: 200,
      contentType: "text/html",
      body: "<h1>Acme</h1>",
      truncated: false,
      attempts: 1,
    });
    expect(userAgent).toBe(USER_AGENT);
  });

  it("follows a relative redirect and reports the URL the body came from", async () => {
    routes.set("/acme/jobs", (_req, res) => {
      res.writeHead(302, { location: "handbook/how-we-hire" });
      res.end();
    });
    routes.set("/acme/handbook/how-we-hire", html("hiring"));

    const result = await fetchPage(`${base}/acme/jobs`, local());
    expect(result).toMatchObject({
      ok: true,
      url: `${base}/acme/handbook/how-we-hire`,
      body: "hiring",
    });
  });

  it("stops reading at the size cap and flags the body as truncated", async () => {
    routes.set("/big", html("x".repeat(50_000)));
    const result = await fetchPage(`${base}/big`, local({ maxBytes: 1_000 }));
    expect(result).toMatchObject({ ok: true, truncated: true });
    expect(result.ok && result.body.length).toBe(1_000);
  });
});

describe("fetchPage — failures are results, not exceptions", () => {
  it("reports a 404 without retrying", async () => {
    const result = await fetchPage(`${base}/missing`, local());
    expect(result).toMatchObject({ ok: false, code: "HTTP_ERROR", status: 404, attempts: 1 });
    expect(hits.get("/missing")).toBe(1);
  });

  it("rejects content that is not a page", async () => {
    routes.set("/report.pdf", (_req, res) => {
      res.writeHead(200, { "content-type": "application/pdf" });
      res.end("%PDF-1.7");
    });
    expect(await fetchPage(`${base}/report.pdf`, local())).toMatchObject({
      ok: false,
      code: "UNSUPPORTED_CONTENT_TYPE",
      attempts: 1,
    });
  });

  it("gives up on a redirect loop", async () => {
    routes.set("/loop", (_req, res) => {
      res.writeHead(302, { location: "/loop" });
      res.end();
    });
    expect(await fetchPage(`${base}/loop`, local())).toMatchObject({
      ok: false,
      code: "TOO_MANY_REDIRECTS",
    });
    expect(hits.get("/loop")).toBe(4); // first request + 3 redirects
  });

  it("times out on a server that never answers, after retrying", async () => {
    routes.set("/slow", () => {
      /* never responds */
    });
    const result = await fetchPage(`${base}/slow`, local({ timeoutMs: 50, maxAttempts: 2 }));
    expect(result).toMatchObject({ ok: false, code: "TIMEOUT", attempts: 2 });
  });

  it("reports a connection failure", async () => {
    const result = await fetchPage("http://127.0.0.1:1/", local({ maxAttempts: 1 }));
    expect(result).toMatchObject({ ok: false, code: "NETWORK_ERROR", attempts: 1 });
  });

  it("does not fetch a blocked URL at all", async () => {
    const fetchImpl = vi.fn();
    const result = await fetchPage("file:///etc/passwd", local({ fetchImpl }));
    expect(result).toMatchObject({ ok: false, code: "BLOCKED_URL", attempts: 1 });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("fetchPage — retries", () => {
  it("retries a 503 and succeeds when the server recovers", async () => {
    routes.set("/flaky", (req, res) => {
      if (hits.get("/flaky") === 1) {
        res.writeHead(503);
        return res.end();
      }
      html("recovered")(req, res);
    });
    const result = await fetchPage(`${base}/flaky`, local());
    expect(result).toMatchObject({ ok: true, body: "recovered", attempts: 2 });
  });

  it("waits as long as Retry-After asks when rate-limited", async () => {
    sleep.mockClear();
    routes.set("/limited", (req, res) => {
      if (hits.get("/limited") === 1) {
        res.writeHead(429, { "retry-after": "2" });
        return res.end();
      }
      html("ok")(req, res);
    });
    expect(await fetchPage(`${base}/limited`, local())).toMatchObject({ ok: true, attempts: 2 });
    expect(sleep).toHaveBeenCalledWith(2_000);
  });

  it("stops after maxAttempts and reports the last failure", async () => {
    routes.set("/down", (_req, res) => {
      res.writeHead(502);
      res.end();
    });
    const result = await fetchPage(`${base}/down`, local());
    expect(result).toMatchObject({ ok: false, code: "HTTP_ERROR", status: 502, attempts: 3 });
    expect(hits.get("/down")).toBe(3);
  });
});

describe("fetchPage — production mode", () => {
  it("refuses to follow a redirect from a public page to a private address", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(null, { status: 302, headers: { location: "http://169.254.169.254/latest/meta-data/" } }),
    );
    const result = await fetchPage("https://example.com/", {
      allowPrivateHosts: false,
      lookup: async () => [{ address: "93.184.216.34" }],
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep,
    });
    expect(result).toMatchObject({
      ok: false,
      code: "BLOCKED_URL",
      url: "http://169.254.169.254/latest/meta-data/",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1); // the private address was never requested
  });
});
