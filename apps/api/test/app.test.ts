import { PipelineError } from "@prepkit/core";
import { Router } from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createApp } from "../src/app";
import { loadConfig } from "../src/config";
import { AppError, conflict, notFound } from "../src/errors";

// A throwaway router whose routes fail in every way the error handler has to deal with.
function failingRoutes(): Router {
  const router = Router();
  router.get("/boom/app-error", () => {
    throw notFound("KIT_NOT_FOUND", "That kit does not exist");
  });
  router.get("/boom/with-details", () => {
    throw conflict("KIT_ALREADY_EXISTS", "You already have a kit for this posting", { kitId: "abc123" });
  });
  router.get("/boom/async", async () => {
    await Promise.resolve();
    throw new AppError(418, "TEAPOT", "Thrown from an async handler");
  });
  router.get("/boom/pipeline/:code", (req) => {
    throw new PipelineError(req.params.code!, "every configured model failed");
  });
  router.post("/boom/validate", (req, res) => {
    const body = z.object({ days: z.int().min(1), jd: z.string().min(1) }).parse(req.body);
    res.json(body);
  });
  router.get("/boom/bug", () => {
    throw new TypeError("Cannot read properties of undefined (reading 'secretInternalField')");
  });
  router.post("/echo", (req, res) => {
    res.json({ received: req.body });
  });
  return router;
}

const MONGODB_URI = "mongodb://unused-in-tests/prepkit";
const config = loadConfig({ NODE_ENV: "test", MONGODB_URI });
const appWith = (logError = vi.fn()) => ({ app: createApp({ config, routers: [failingRoutes()], logError }), logError });

describe("GET /api/health", () => {
  it("answers without needing a session, a database or a model", async () => {
    const response = await request(createApp({ config })).get("/api/health");
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: "ok", env: "test", uptimeSeconds: expect.any(Number) });
  });

  it("sends security headers and does not advertise the framework", async () => {
    const response = await request(createApp({ config })).get("/api/health");
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["x-powered-by"]).toBeUndefined();
  });
});

describe("error responses — one envelope for everything", () => {
  it("turns a thrown AppError into its status, code and message", async () => {
    const { app, logError } = appWith();
    const response = await request(app).get("/api/boom/app-error");

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: { code: "KIT_NOT_FOUND", message: "That kit does not exist" } });
    expect(logError).not.toHaveBeenCalled(); // expected failures are not logged as bugs
  });

  it("includes details when the error carries them", async () => {
    const response = await request(appWith().app).get("/api/boom/with-details");
    expect(response.status).toBe(409);
    expect(response.body.error).toEqual({
      code: "KIT_ALREADY_EXISTS",
      message: "You already have a kit for this posting",
      details: { kitId: "abc123" },
    });
  });

  it("catches an error thrown inside an async handler, with no wrapper around the route", async () => {
    const response = await request(appWith().app).get("/api/boom/async");
    expect(response.status).toBe(418);
    expect(response.body.error.code).toBe("TEAPOT");
  });

  it("answers an unknown route in the same envelope", async () => {
    const response = await request(appWith().app).get("/api/no-such-thing");
    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: { code: "ROUTE_NOT_FOUND", message: "No route for GET /api/no-such-thing" } });
  });
});

describe("error responses — pipeline failures keep their code", () => {
  it.each([
    ["INVALID_INPUT", 400],
    ["LLM_RATE_LIMITED", 503],
    ["LLM_UNAVAILABLE", 503],
    ["LLM_NOT_CONFIGURED", 503],
    ["LLM_AUTH_FAILED", 502],
    ["INVALID_KIT", 502],
  ])("maps %s to HTTP %i", async (code, status) => {
    const response = await request(appWith().app).get(`/api/boom/pipeline/${code}`);
    expect(response.status).toBe(status);
    expect(response.body).toEqual({ error: { code, message: "every configured model failed" } });
  });

  it("treats a pipeline code it does not know as a 500, and logs it", async () => {
    const { app, logError } = appWith();
    const response = await request(app).get("/api/boom/pipeline/SOMETHING_NEW");
    expect(response.status).toBe(500);
    expect(logError).toHaveBeenCalledOnce();
  });
});

describe("error responses — bad requests", () => {
  it("lists every invalid field from a zod validation failure", async () => {
    const response = await request(appWith().app).post("/api/boom/validate").send({ days: 0 });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_FAILED");
    expect(response.body.error.details).toEqual([
      { path: "days", message: expect.any(String) },
      { path: "jd", message: expect.any(String) },
    ]);
  });

  it("rejects a body that is not valid JSON", async () => {
    const response = await request(appWith().app).post("/api/echo").set("content-type", "application/json").send('{"days": ');
    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: { code: "INVALID_JSON", message: "The request body is not valid JSON" } });
  });

  it("rejects a body over the size limit", async () => {
    const response = await request(appWith().app).post("/api/echo").send({ jd: "x".repeat(1_100_000) });
    expect(response.status).toBe(413);
    expect(response.body.error.code).toBe("BODY_TOO_LARGE");
  });

  it("accepts a realistic job description", async () => {
    const jd = "Senior Backend Engineer\n\n".concat("- a requirement line\n".repeat(400));
    const response = await request(appWith().app).post("/api/echo").send({ jd });
    expect(response.status).toBe(200);
    expect(response.body.received.jd).toHaveLength(jd.length);
  });
});

describe("error responses — bugs", () => {
  it("answers 500 with a fixed sentence, never the internal message, and logs the real error", async () => {
    const { app, logError } = appWith();
    const response = await request(app).get("/api/boom/bug");

    expect(response.status).toBe(500);
    expect(response.body).toEqual({
      error: { code: "INTERNAL_ERROR", message: "Something went wrong on our side. Please try again." },
    });
    expect(JSON.stringify(response.body)).not.toContain("secretInternalField");
    expect(logError).toHaveBeenCalledWith("[api] unexpected error on GET /api/boom/bug", expect.any(TypeError));
  });
});

describe("loadConfig", () => {
  it("defaults to development on port 4000, where private hosts may be fetched", () => {
    expect(loadConfig({ MONGODB_URI })).toEqual({
      env: "development",
      port: 4000,
      mongodbUri: MONGODB_URI,
      webOrigin: "http://localhost:3000",
      isProduction: false,
      allowPrivateHosts: true,
    });
  });

  it("never allows private hosts in production, with no flag that could change it", () => {
    const config = loadConfig({ NODE_ENV: "production", PORT: "8080", MONGODB_URI, ALLOW_PRIVATE_HOSTS: "true" });
    expect(config).toMatchObject({ env: "production", port: 8080, isProduction: true, allowPrivateHosts: false });
  });

  it("fails at startup, naming the variable, when the environment is invalid", () => {
    expect(() => loadConfig({ MONGODB_URI, PORT: "not-a-port" })).toThrow(/Invalid environment: PORT/);
    expect(() => loadConfig({ MONGODB_URI, NODE_ENV: "staging" })).toThrow(/Invalid environment: NODE_ENV/);
  });

  it("treats a variable left empty, as in a copied .env.example, as not set", () => {
    const config = loadConfig({ MONGODB_URI, WEB_ORIGIN: "", PORT: "  ", NODE_ENV: "" });
    expect(config).toMatchObject({ env: "development", port: 4000, webOrigin: "http://localhost:3000" });
    expect(() => loadConfig({ MONGODB_URI: "" })).toThrow(/MONGODB_URI: is required/);
  });

  it("requires a MongoDB connection string, and says where to look", () => {
    expect(() => loadConfig({})).toThrow("Invalid environment: MONGODB_URI: is required (see .env.example)");
    expect(() => loadConfig({ MONGODB_URI: "postgres://nope" })).toThrow(/MONGODB_URI: must start with mongodb/);
  });

  it("reduces WEB_ORIGIN to an origin, so a trailing slash or path cannot break the comparison", () => {
    expect(loadConfig({ MONGODB_URI, WEB_ORIGIN: "https://prepkit.example.com/" }).webOrigin).toBe("https://prepkit.example.com");
    expect(() => loadConfig({ MONGODB_URI, WEB_ORIGIN: "not a url" })).toThrow(/Invalid environment: WEB_ORIGIN/);
  });
});
