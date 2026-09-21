import { randomUUID } from "node:crypto";
import type { Session, SessionRepository, User, UserRepository } from "../../src/auth/repository";
import { initialMeta } from "@prepkit/core";
import { toSummary } from "../../src/kits/repository";
import type { KitRecord, KitRepository } from "../../src/kits/repository";

// In-memory implementations of the repository interfaces. The API's tests run against these,
// so `npm test` needs no database, no downloaded binary and no network. They honour the same
// contract as the MongoDB ones — notably, create() returns null for a duplicate email.

export function createMemoryUserRepository(): UserRepository & { all(): User[] } {
  const users = new Map<string, User>();
  return {
    all: () => [...users.values()],
    async create(input) {
      if ([...users.values()].some((u) => u.email === input.email)) return null;
      const user: User = { id: randomUUID(), ...input };
      users.set(user.id, user);
      return { ...user };
    },
    async findByEmail(email) {
      const user = [...users.values()].find((u) => u.email === email);
      return user ? { ...user } : null;
    },
    async findById(id) {
      const user = users.get(id);
      return user ? { ...user } : null;
    },
  };
}

export function createMemorySessionRepository(): SessionRepository & { all(): Session[] } {
  const sessions = new Map<string, Session>();
  return {
    all: () => [...sessions.values()],
    async create(session) {
      sessions.set(session.tokenHash, { ...session });
    },
    async findByTokenHash(tokenHash) {
      const session = sessions.get(tokenHash);
      return session ? { ...session } : null;
    },
    async delete(tokenHash) {
      sessions.delete(tokenHash);
    },
  };
}

export function createMemoryKitRepository(): KitRepository & { all(): KitRecord[]; peek(id: string): KitRecord } {
  const kits = new Map<string, KitRecord>();
  const copy = (record: KitRecord): KitRecord => structuredClone(record);
  const update = (id: string, change: (record: KitRecord) => void) => {
    const record = kits.get(id);
    if (record) change(record);
  };

  return {
    all: () => [...kits.values()].map(copy),
    /** Test-only: look at a stored record, whoever owns it. The real repository has no such method. */
    peek(id) {
      const record = kits.get(id);
      if (!record) throw new Error(`no kit ${id} in the in-memory repository`);
      return copy(record);
    },
    async insert(record) {
      // The same contract as the unique index on (userId, fingerprint).
      if ([...kits.values()].some((k) => k.userId === record.userId && k.fingerprint === record.fingerprint)) return null;
      const stored: KitRecord = { id: randomUUID(), ...structuredClone(record) };
      kits.set(stored.id, stored);
      return copy(stored);
    },
    async findOwned(id, userId) {
      const record = kits.get(id);
      return record && record.userId === userId ? copy(record) : null;
    },
    async findByFingerprint(userId, fingerprint) {
      const record = [...kits.values()].find((k) => k.userId === userId && k.fingerprint === fingerprint);
      return record ? copy(record) : null;
    },
    async listOwned(userId) {
      return [...kits.values()]
        .filter((k) => k.userId === userId)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .map(toSummary);
    },
    async deleteOwned(id, userId) {
      const record = kits.get(id);
      if (!record || record.userId !== userId) return false;
      return kits.delete(id);
    },
    async claim(id, at) {
      const record = kits.get(id);
      if (!record || record.status !== "queued") return null;
      Object.assign(record, { status: "running", updatedAt: at });
      return copy(record);
    },
    async appendProgress(id, event, at) {
      update(id, (r) => {
        r.progress.push(structuredClone(event));
        r.updatedAt = at;
      });
    },
    async markReady(id, kit, at) {
      update(id, (r) => Object.assign(r, { status: "ready", kit: structuredClone(kit), meta: initialMeta(kit), rev: r.rev + 1, error: null, updatedAt: at }));
    },
    async markFailed(id, error, at) {
      update(id, (r) => Object.assign(r, { status: "failed", error, updatedAt: at }));
    },
    async saveEdited(id, userId, expectedRev, kit, meta, at) {
      const record = kits.get(id);
      // The same condition as the MongoDB filter: the owner, a ready kit, and an unchanged revision.
      if (!record || record.userId !== userId || record.status !== "ready" || record.rev !== expectedRev) return false;
      Object.assign(record, { kit: structuredClone(kit), meta: structuredClone(meta), rev: record.rev + 1, updatedAt: at });
      return true;
    },
    async requeueOwned(id, userId, at) {
      const record = kits.get(id);
      if (!record || record.userId !== userId || record.status !== "failed") return false;
      Object.assign(record, { status: "queued", error: null, progress: [], kit: null, meta: null, updatedAt: at });
      return true;
    },
    async failUnfinished(error, at) {
      const unfinished = [...kits.values()].filter((k) => k.status === "queued" || k.status === "running");
      for (const record of unfinished) Object.assign(record, { status: "failed", error, updatedAt: at });
      return unfinished.length;
    },
  };
}
