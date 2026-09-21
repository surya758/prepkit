import { createHash, randomUUID } from "node:crypto";
import { AppError, conflict, notFound } from "../errors";
import type { PracticeRepository } from "../practice/repository";
import type { JobRunner } from "./job-runner";
import { toSummary } from "./repository";
import type { KitInput, KitRecord, KitRepository, KitSummary } from "./repository";
import { createKitSchema } from "./schemas";

// The rules about kits. No HTTP and no MongoDB syntax in here.

export interface CreateKitInput extends KitInput {
  /** Generate a fresh kit even though one already exists for this posting. */
  force?: boolean;
  /**
   * Sent by the interface with a forced request: one id per press of "generate fresh anyway".
   * A forced kit is exempt from the content check, which would also exempt it from
   * double-click protection; the key puts that back. Ignored when force is not set.
   */
  idempotencyKey?: string;
}

/** The outcome for one row of an uploaded file. */
export type BulkResult =
  | { index: number; status: "created"; kit: KitSummary }
  | { index: number; status: "duplicate"; kitId?: string; message: string }
  | { index: number; status: "invalid"; message: string; details?: unknown };

export interface KitServiceDependencies {
  kits: KitRepository;
  runner: JobRunner;
  /** A deleted kit takes its practice ratings with it. */
  practice: Pick<PracticeRepository, "deleteForKit">;
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

export function createKitService({ kits, runner, practice, now = () => new Date() }: KitServiceDependencies) {
  return {
    /** Records the kit as queued, hands it to the runner, and returns without waiting for it. */
    async create(userId: string, input: CreateKitInput): Promise<KitSummary> {
      const { force, idempotencyKey, ...kitInput } = input;
      const base = fingerprintOf(kitInput);
      // Content identity recognises a repeat. A forced kit is a wanted repeat, so it gets a
      // fingerprint of its own and can live alongside the original — built from the request's
      // idempotency key, so that the same press arriving twice still makes one kit.
      const fingerprint = force ? `${base}:${idempotencyKey ?? randomUUID()}` : base;
      const at = now();

      const record = await kits.insert({
        userId,
        input: kitInput,
        fingerprint,
        status: "queued",
        progress: [],
        error: null,
        kit: null,
        meta: null,
        rev: 0,
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

    /** Several postings at once. Each row is validated and created on its own. */
    async createMany(userId: string, items: unknown[]): Promise<BulkResult[]> {
      const results: BulkResult[] = [];
      for (const [index, item] of items.entries()) {
        const parsed = createKitSchema.safeParse(item);
        if (!parsed.success) {
          results.push({
            index,
            status: "invalid",
            message: "Some fields are missing or invalid",
            details: parsed.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
          });
          continue;
        }
        try {
          // An uploaded file never forces: a row that repeats an existing kit is reported, not regenerated.
          const { force: _force, ...kitInput } = parsed.data;
          results.push({ index, status: "created", kit: await this.create(userId, kitInput) });
        } catch (error) {
          if (error instanceof AppError && error.code === "KIT_ALREADY_EXISTS") {
            results.push({ index, status: "duplicate", kitId: (error.details as { kitId?: string } | undefined)?.kitId, message: error.message });
          } else {
            throw error;
          }
        }
      }
      return results;
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
      // The kit first. If this second step fails, what is left is ratings nobody can reach —
      // a kit's id is never issued again — rather than a kit whose progress silently vanished.
      await practice.deleteForKit(userId, kitId);
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
