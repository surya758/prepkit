import { resolve } from "node:path";
import { createApp } from "./app";
import { loadConfig } from "./config";

// The only file with side effects: it reads .env, opens a port and handles shutdown.

// `npm run dev -w @prepkit/api` runs from apps/api, a deploy usually from the repo root. A
// .env file is a local convenience and never overrides variables that are already set.
for (const candidate of [resolve(process.cwd(), ".env"), resolve(process.cwd(), "../../.env")]) {
  try {
    process.loadEnvFile(candidate);
    break;
  } catch {
    // Not there; the environment is used as it is.
  }
}

const config = loadConfig();
const app = createApp({ config });

const server = app.listen(config.port, () => {
  console.log(`[api] listening on :${config.port} (${config.env})`);
});

// Hosting platforms stop a container with SIGTERM. Finish the requests in flight, then leave.
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.once(signal, () => {
    console.log(`[api] ${signal} received, shutting down`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10_000).unref();
  });
}
