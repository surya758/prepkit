import { createHash, randomUUID } from "node:crypto";
import { AppError, conflict, notFound } from "../errors";
import type { JobRunner } from "./job-runner";
import { toSummary } from "./repository";
import type { KitInput, KitRecord, KitRepository, KitSummary } from "./repository";

// The rules about kits. No HTTP and no MongoDB syntax in here.

export interface CreateKitInput extends KitInput {
  /** Generate a fresh kit even though one already exists for this posting. */
  force?: boolean;
}

export interface KitServiceDependencies {
  kits: KitRepository;
  runner: JobRunner;
  now?: () => Date;
}

const normalise = (text: string) => text.trim().replace(/\s+/g, " ").toLowerCase();

/**
 * Identifies a posting: the description plus the company. The number of days is left out on
 * purpose — the same posting with a different deadline is the same research, and a schedule
 * can be rebuilt without generating anything again.
 */
export function fingerprintOf(input: Pick<KitInput, "jd" | "companyUrl">): string {
  const url = normalise(input.companyUrl).replace(/\/+$/, "");
  return createHash("sha256").update(`${normalise(input.jd)}\n${url}`).digest("hex");
}

// Someone else's kit and a kit that does not exist get the same answer. A 403 would confirm
// that the id is real.
const kitNotFound = () => notFound("KIT_NOT_FOUND", "That kit does not exist");

export type KitService = ReturnType<typeof createKitService>;

export function createKitService({ kits, runner, now = () => new Date() }: KitServiceDependencies) {
  return {
    /** Records the kit as queued, hands it to the runner, and returns without waiting for it. */
    async create(userId: string, input: CreateKitInput): Promise<KitSummary> {
      const { force, ...kitInput } = input;
      const base = fingerprintOf(kitInput);
      // A forced kit gets a fingerprint of its own, so it can live alongside the original.
      const fingerprint = force ? `${base}:${randomUUID()}` : base;
      const at = now();

      const record = await kits.insert({
        userId,
        input: kitInput,
        fingerprint,
        status: "queued",
        progress: [],
        error: null,
        kit: null,
        createdAt: at,
        updatedAt: at,
      });

      if (!record) {
        // Same posting submitted again, or the button pressed twice. The interface offers to
        // open the existing kit, or to call again with force.
        const existing = await kits.findByFingerprint(userId, fingerprint);
        throw conflict("KIT_ALREADY_EXISTS", "You already have a kit for this job description and company", {
          kitId: existing?.id,
          status: existing?.status,
        });
      }

      runner.enqueue(record.id);
      return toSummary(record);
    },

    list(userId: string): Promise<KitSummary[]> {
      return kits.listOwned(userId);
    },

    async get(userId: string, kitId: string): Promise<KitRecord> {
      const record = await kits.findOwned(kitId, userId);
      if (!record) throw kitNotFound();
      return record;
    },

    async remove(userId: string, kitId: string): Promise<void> {
      if (!(await kits.deleteOwned(kitId, userId))) throw kitNotFound();
    },

    /** Runs a failed kit again, from the start, keeping its id. */
    async retry(userId: string, kitId: string): Promise<KitSummary> {
      const record = await kits.findOwned(kitId, userId);
      if (!record) throw kitNotFound();
      if (!(await kits.requeueOwned(kitId, userId, now()))) {
        throw new AppError(409, "KIT_NOT_RETRYABLE", `Only a failed kit can be retried; this one is ${record.status}`);
      }
      runner.enqueue(kitId);
      return toSummary({ ...record, status: "queued", error: null, progress: [] });
    },
  };
}
