import express from "express";
import type { Express, Router } from "express";
import helmet from "helmet";
import type { Config } from "./config";
import { createErrorHandler, notFoundHandler } from "./middleware/error-handler";

// Builds the application and does nothing else: no port, no database connection, no reading
// of the environment. Tests create one per case; server.ts creates the real one.

export const MAX_BODY_BYTES = "1mb";

export interface AppDependencies {
  config: Config;
  /** Feature routers, mounted under /api. Added as each part of the API is built. */
  routers?: Router[];
  logError?: (message: string, error: unknown) => void;
}

export function createApp({ config, routers = [], logError }: AppDependencies): Express {
  const app = express();
  const startedAt = Date.now();

  app.disable("x-powered-by");
  // The API sits behind the hosting platform's proxy; this makes req.ip and secure cookies right.
  if (config.isProduction) app.set("trust proxy", 1);
  app.use(helmet());
  // A job description is a few kilobytes; a file of several is still well under this.
  app.use(express.json({ limit: MAX_BODY_BYTES }));

  // Deliberately public and dependency-free: the web app calls it on load to tell a sleeping
  // free-tier host from a broken one.
  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", env: config.env, uptimeSeconds: Math.round((Date.now() - startedAt) / 1000) });
  });

  for (const router of routers) app.use("/api", router);

  app.use(notFoundHandler);
  app.use(createErrorHandler(logError));
  return app;
}
