import { randomUUID } from "node:crypto";
import type { Session, SessionRepository, User, UserRepository } from "../../src/auth/repository";

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
