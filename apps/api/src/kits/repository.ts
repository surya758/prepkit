import { initialMeta } from "@prepkit/core";
import type { Kit, KitMeta, ProgressEvent } from "@prepkit/core";
import { ObjectId } from "mongodb";
import type { Collection, Db } from "mongodb";

// A kit as the application stores it: the pipeline's kit plus who owns it, what was asked
// for, and how generation is going. Every method that touches a kit takes the owner's id —
// there is no "find by id" — so forgetting the ownership check is not possible.

export type KitStatus = "queued" | "running" | "ready" | "failed";

export interface KitInput {
  jd: string;
  companyUrl: string;
  days: number;
}

export interface KitRecord {
  id: string;
  userId: string;
  input: KitInput;
  /** Identifies the posting (description + company), so a repeat submission can be recognised. */
  fingerprint: string;
  status: KitStatus;
  /** Every step event so far, in order. A page that reloads mid-generation redraws from this. */
  progress: ProgressEvent[];
  error: { code: string; message: string } | null;
  kit: Kit | null;
  /** Which items the user wrote, changed or pinned. Beside the kit, never inside it. */
  meta: KitMeta | null;
  /** Goes up by one on every saved change. A save names the revision it was based on. */
  rev: number;
  createdAt: Date;
  updatedAt: Date;
}

/** What a list of kits needs: no description text and no kit body. */
export interface KitSummary {
  id: string;
  status: KitStatus;
  title: string;
  company: string;
  days: number;
  error: KitRecord["error"];
  createdAt: Date;
  updatedAt: Date;
}

export interface KitRepository {
  /** Returns null when this user already has a kit with this fingerprint. */
  insert(record: Omit<KitRecord, "id">): Promise<KitRecord | null>;
  findOwned(id: string, userId: string): Promise<KitRecord | null>;
  findByFingerprint(userId: string, fingerprint: string): Promise<KitRecord | null>;
  listOwned(userId: string): Promise<KitSummary[]>;
  deleteOwned(id: string, userId: string): Promise<boolean>;

  // Used by the job runner, which works on a job it was handed rather than on a user's request.
  findForJob(id: string): Promise<KitRecord | null>;
  /**
   * Takes a queued kit for running, in one atomic step, and returns it. Null when it is not
   * queued any more — deleted, or already claimed — so a kit can never be generated twice.
   */
  claim(id: string, at: Date): Promise<KitRecord | null>;
  appendProgress(id: string, event: ProgressEvent, at: Date): Promise<void>;
  markReady(id: string, kit: Kit, at: Date): Promise<void>;
  markFailed(id: string, error: { code: string; message: string }, at: Date): Promise<void>;
  /**
   * Saves an edited kit only if nobody else has saved since `expectedRev` was read. False means
   * "someone got there first": the caller loads the kit again and re-applies its change, so two
   * changes landing together are both kept instead of the second overwriting the first.
   */
  saveEdited(id: string, userId: string, expectedRev: number, kit: Kit, meta: KitMeta, at: Date): Promise<boolean>;
  /** Back to queued with a clean slate, for a retry. False when the kit is not the user's or not failed. */
  requeueOwned(id: string, userId: string, at: Date): Promise<boolean>;
  /** At startup: anything still queued or running belonged to a process that is gone. */
  failUnfinished(error: { code: string; message: string }, at: Date): Promise<number>;
}

/** The first non-empty line of a description, for a kit that has no title yet. */
export function titleFrom(record: Pick<KitRecord, "kit" | "input">): string {
  const fromKit = record.kit?.role.title || record.kit?.source.role;
  if (fromKit) return fromKit;
  const firstLine = record.input.jd.split(/\r?\n/).find((line) => line.trim())?.trim() ?? "Untitled role";
  return firstLine.length > 80 ? `${firstLine.slice(0, 79)}…` : firstLine;
}

export const toSummary = (record: KitRecord): KitSummary => ({
  id: record.id,
  status: record.status,
  title: titleFrom(record),
  company: record.kit?.source.company ?? "",
  days: record.input.days,
  error: record.error,
  createdAt: record.createdAt,
  updatedAt: record.updatedAt,
});

type KitDocument = Omit<KitRecord, "id"> & { _id: ObjectId };

const DUPLICATE_KEY = 11000;
const toRecord = ({ _id, ...rest }: KitDocument): KitRecord => ({ id: _id.toHexString(), ...rest });
const objectId = (id: string) => (ObjectId.isValid(id) ? new ObjectId(id) : null);

export function createKitRepository(db: Db): KitRepository {
  const kits: Collection<KitDocument> = db.collection("kits");

  return {
    async insert(record) {
      const _id = new ObjectId();
      try {
        await kits.insertOne({ _id, ...record });
        return toRecord({ _id, ...record });
      } catch (error) {
        // The unique index on (userId, fingerprint) is what makes a double-click safe: of two
        // simultaneous inserts, exactly one succeeds.
        if ((error as { code?: number }).code === DUPLICATE_KEY) return null;
        throw error;
      }
    },
    async findOwned(id, userId) {
      const _id = objectId(id);
      const doc = _id && (await kits.findOne({ _id, userId }));
      return doc ? toRecord(doc) : null;
    },
    async findByFingerprint(userId, fingerprint) {
      const doc = await kits.findOne({ userId, fingerprint });
      return doc ? toRecord(doc) : null;
    },
    async listOwned(userId) {
      // The description and most of the kit are left in the database: a list does not need them.
      const docs = await kits
        .find({ userId }, { projection: { progress: 0, "input.companyUrl": 0, "kit.questions": 0, "kit.flashcards": 0, "kit.schedule": 0, "kit.research_log": 0 } })
        .sort({ createdAt: -1 })
        .toArray();
      return docs.map((doc) => toSummary(toRecord({ ...doc, progress: [] } as KitDocument)));
    },
    async deleteOwned(id, userId) {
      const _id = objectId(id);
      return _id ? (await kits.deleteOne({ _id, userId })).deletedCount === 1 : false;
    },

    async findForJob(id) {
      const _id = objectId(id);
      const doc = _id && (await kits.findOne({ _id }));
      return doc ? toRecord(doc) : null;
    },
    async claim(id, at) {
      const _id = objectId(id);
      if (!_id) return null;
      const doc = await kits.findOneAndUpdate(
        { _id, status: "queued" },
        { $set: { status: "running", updatedAt: at } },
        { returnDocument: "after" },
      );
      return doc ? toRecord(doc) : null;
    },
    async appendProgress(id, event, at) {
      await kits.updateOne({ _id: new ObjectId(id) }, { $push: { progress: event }, $set: { updatedAt: at } });
    },
    async markReady(id, kit, at) {
      await kits.updateOne(
        { _id: new ObjectId(id) },
        { $set: { status: "ready", kit, meta: initialMeta(kit), error: null, updatedAt: at }, $inc: { rev: 1 } },
      );
    },
    async markFailed(id, error, at) {
      await kits.updateOne({ _id: new ObjectId(id) }, { $set: { status: "failed", error, updatedAt: at } });
    },
    async saveEdited(id, userId, expectedRev, kit, meta, at) {
      const _id = objectId(id);
      if (!_id) return false;
      const result = await kits.updateOne({ _id, userId, status: "ready", rev: expectedRev }, { $set: { kit, meta, updatedAt: at }, $inc: { rev: 1 } });
      return result.modifiedCount === 1;
    },
    async requeueOwned(id, userId, at) {
      const _id = objectId(id);
      if (!_id) return false;
      const result = await kits.updateOne(
        { _id, userId, status: "failed" },
        { $set: { status: "queued", error: null, progress: [], kit: null, meta: null, updatedAt: at } },
      );
      return result.modifiedCount === 1;
    },
    async failUnfinished(error, at) {
      const result = await kits.updateMany({ status: { $in: ["queued", "running"] } }, { $set: { status: "failed", error, updatedAt: at } });
      return result.modifiedCount;
    },
  };
}

/** Run once at startup. */
export async function ensureKitIndexes(db: Db): Promise<void> {
  await db.collection("kits").createIndex({ userId: 1, fingerprint: 1 }, { unique: true });
  await db.collection("kits").createIndex({ userId: 1, createdAt: -1 });
}
