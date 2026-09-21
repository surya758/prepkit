import { MongoClient } from "mongodb";
import type { Db } from "mongodb";
import { ensureAuthIndexes } from "./auth/repository";
import { ensureKitIndexes } from "./kits/repository";
import { ensurePracticeIndexes } from "./practice/repository";

export const DEFAULT_DATABASE = "prepkit";

/** The database named in a connection string's path, if any: mongodb+srv://host/<this>?options */
export function databaseNameIn(uri: string): string | undefined {
  const path = /^mongodb(?:\+srv)?:\/\/[^/]+\/([^?]*)/.exec(uri)?.[1];
  return path ? decodeURIComponent(path) : undefined;
}

export interface Database {
  db: Db;
  close(): Promise<void>;
}

/** Connects, makes sure the indexes exist, and fails fast with a readable message if it cannot. */
export async function connectDatabase(uri: string): Promise<Database> {
  // A free Atlas cluster that is paused or unreachable should fail startup in seconds, not hang.
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 8_000 });
  try {
    await client.connect();
  } catch (error) {
    throw new Error(`Could not connect to MongoDB: ${error instanceof Error ? error.message : String(error)}`);
  }
  // The driver's own fallback is a database called "test", which is an easy thing to fill by
  // accident. A name in the connection string wins; otherwise it is this one.
  const db = client.db(databaseNameIn(uri) ?? DEFAULT_DATABASE);
  await ensureAuthIndexes(db);
  await ensureKitIndexes(db);
  await ensurePracticeIndexes(db);
  return { db, close: () => client.close() };
}
