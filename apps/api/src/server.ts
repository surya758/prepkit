import { resolve } from "node:path";
import { createApp } from "./app";
import { createSessionRepository, createUserRepository } from "./auth/repository";
import { createAuthRouter } from "./auth/routes";
import { createAuthService } from "./auth/service";
import { loadConfig } from "./config";
import { connectDatabase } from "./db";

// The only file with side effects: it reads .env, connects to the database, assembles the
// services from their dependencies, opens a port and handles shutdown.

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
const database = await connectDatabase(config.mongodbUri);
console.log(`[api] connected to MongoDB (database "${database.db.databaseName}")`);

const auth = createAuthService({
  users: createUserRepository(database.db),
  sessions: createSessionRepository(database.db),
});

const app = createApp({ config, routers: [createAuthRouter({ auth, config })] });

const server = app.listen(config.port, () => {
  console.log(`[api] listening on :${config.port} (${config.env}), accepting requests from ${config.webOrigin}`);
});

// Hosting platforms stop a container with SIGTERM. Finish the requests in flight, close the
// database, then leave.
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.once(signal, () => {
    console.log(`[api] ${signal} received, shutting down`);
    server.close(() => {
      void database.close().finally(() => process.exit(0));
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  });
}
