import { ObjectId } from "mongodb";
import type { Collection, Db } from "mongodb";

// What the auth service needs from storage, and nothing else. Tests use an in-memory
// implementation of the same interfaces; these are the MongoDB ones. They are kept thin on
// purpose — no decisions, only reads and writes — because the decisions are in the service,
// where they are tested.

export interface User {
  id: string;
  email: string;
  passwordHash: string;
  createdAt: Date;
}

export interface Session {
  /** SHA-256 of the cookie's token. The token itself is never stored. */
  tokenHash: string;
  userId: string;
  expiresAt: Date;
}

export interface UserRepository {
  /** Returns null when the email is already registered. */
  create(input: { email: string; passwordHash: string; createdAt: Date }): Promise<User | null>;
  findByEmail(email: string): Promise<User | null>;
  findById(id: string): Promise<User | null>;
}

export interface SessionRepository {
  create(session: Session): Promise<void>;
  findByTokenHash(tokenHash: string): Promise<Session | null>;
  delete(tokenHash: string): Promise<void>;
}

interface UserDocument {
  _id: ObjectId;
  email: string;
  passwordHash: string;
  createdAt: Date;
}

const DUPLICATE_KEY = 11000;
const toUser = (doc: UserDocument): User => ({ id: doc._id.toHexString(), email: doc.email, passwordHash: doc.passwordHash, createdAt: doc.createdAt });

export function createUserRepository(db: Db): UserRepository {
  const users: Collection<UserDocument> = db.collection("users");
  return {
    async create(input) {
      try {
        const _id = new ObjectId();
        await users.insertOne({ _id, ...input });
        return toUser({ _id, ...input });
      } catch (error) {
        // The unique index on email is what makes two simultaneous registrations safe.
        if ((error as { code?: number }).code === DUPLICATE_KEY) return null;
        throw error;
      }
    },
    async findByEmail(email) {
      const doc = await users.findOne({ email });
      return doc ? toUser(doc) : null;
    },
    async findById(id) {
      if (!ObjectId.isValid(id)) return null;
      const doc = await users.findOne({ _id: new ObjectId(id) });
      return doc ? toUser(doc) : null;
    },
  };
}

export function createSessionRepository(db: Db): SessionRepository {
  const sessions: Collection<Session> = db.collection("sessions");
  return {
    async create(session) {
      await sessions.insertOne({ ...session });
    },
    async findByTokenHash(tokenHash) {
      const doc = await sessions.findOne({ tokenHash }, { projection: { _id: 0 } });
      return doc ?? null;
    },
    async delete(tokenHash) {
      await sessions.deleteOne({ tokenHash });
    },
  };
}

/** Run once at startup. */
export async function ensureAuthIndexes(db: Db): Promise<void> {
  await db.collection("users").createIndex({ email: 1 }, { unique: true });
  await db.collection("sessions").createIndex({ tokenHash: 1 }, { unique: true });
  // MongoDB deletes expired sessions by itself; the service still checks the date on every read.
  await db.collection("sessions").createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
}
