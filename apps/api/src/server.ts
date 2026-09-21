import { resolve } from "node:path";
import { createChainFromEnv, generateKit, regenerateBriefFresh, regenerateCategoryDrafts } from "@prepkit/core";
import type { LlmProvider } from "@prepkit/core";
import { createApp } from "./app";
import { createSessionRepository, createUserRepository } from "./auth/repository";
import { createAuthRouter } from "./auth/routes";
import { createAuthService } from "./auth/service";
import { loadConfig } from "./config";
import { connectDatabase } from "./db";
import { createBuilderRouter } from "./kits/builder-routes";
import { createBuilderService } from "./kits/builder-service";
import { createJobRunner } from "./kits/job-runner";
import { createKitRepository } from "./kits/repository";
import { createKitRouter } from "./kits/routes";
import { createKitService } from "./kits/service";
import { createRequireUser } from "./middleware/require-user";

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

// A missing model key must not stop people signing in and reading the kits they already have.
// Generation then fails per kit, with a message that says which variable to set.
let llm: LlmProvider;
try {
  const { chain, active, skipped } = createChainFromEnv();
  llm = chain;
  console.log(`[api] models: ${active.join(" -> ")}`);
  for (const model of skipped) console.log(`[api]   not used: ${model.model} (${model.reason})`);
} catch (error) {
  console.warn(`[api] no model is configured: ${error instanceof Error ? error.message : String(error)}`);
  llm = { name: "unconfigured", complete: () => Promise.reject(error) };
}

const auth = createAuthService({
  users: createUserRepository(database.db),
  sessions: createSessionRepository(database.db),
});

const kitRepository = createKitRepository(database.db);
const runner = createJobRunner({
  kits: kitRepository,
  // The same function the batch command calls. In production it refuses private addresses;
  // `npm run evaluate` is what allows localhost company sites.
  generate: (input, onProgress) => generateKit(input, { llm, allowPrivateHosts: config.allowPrivateHosts, onProgress }),
});

// Before accepting requests: whatever a previous process left unfinished will never finish.
const interrupted = await runner.failInterrupted();
if (interrupted > 0) console.log(`[api] marked ${interrupted} kit(s) interrupted by the last restart`);

const requireUser = createRequireUser(auth);
const builder = createBuilderService({
  kits: kitRepository,
  regenerate: {
    categoryDrafts: async (kit, category, lockedCount) => (await regenerateCategoryDrafts(llm, kit, category, lockedCount)).drafts,
    brief: async (kit) => (await regenerateBriefFresh(llm, kit, { allowPrivateHosts: config.allowPrivateHosts })).brief,
  },
});

const app = createApp({
  config,
  routers: [
    createAuthRouter({ auth, config }),
    createKitRouter({ kits: createKitService({ kits: kitRepository, runner }), requireUser }),
    createBuilderRouter({ builder, requireUser }),
  ],
});

const server = app.listen(config.port, () => {
  console.log(`[api] listening on :${config.port} (${config.env}), accepting requests from ${config.webOrigin}`);
});

// Hosting platforms stop a container with SIGTERM. Stop taking requests, give kits that are
// generating a moment to finish, close the database, then leave.
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.once(signal, () => {
    console.log(`[api] ${signal} received, shutting down`);
    server.close(() => {
      void Promise.race([runner.idle(), new Promise((r) => setTimeout(r, 8_000))])
        .then(() => database.close())
        .finally(() => process.exit(0));
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  });
}
