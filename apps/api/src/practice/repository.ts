import type { Confidence, PracticeRecord } from "@prepkit/core";
import type { Collection, Db, ObjectId } from "mongodb";

// One document per user, kit and card: how confident the user last felt about that card.
// Like kits, every method takes the owner's id.

export interface PracticeRepository {
  listForKit(userId: string, kitId: string): Promise<PracticeRecord[]>;
  /**
   * Records a rating in one atomic step: the first rating of a card creates its record, a
   * later one replaces the confidence and counts another review. Two ratings arriving
   * together are therefore both counted; neither is lost to a read that went stale.
   */
  rate(userId: string, kitId: string, cardId: string, confidence: Confidence, at: Date): Promise<PracticeRecord>;
  /** Starting over, or the kit is being deleted. Returns how many records went. */
  deleteForKit(userId: string, kitId: string): Promise<number>;
}

interface PracticeDocument {
  _id: ObjectId;
  userId: string;
  kitId: string;
  cardId: string;
  confidence: Confidence;
  reps: number;
  reviewedAt: Date;
}

const toRecord = (doc: PracticeDocument): PracticeRecord => ({
  cardId: doc.cardId,
  confidence: doc.confidence,
  reps: doc.reps,
  reviewedAt: doc.reviewedAt.toISOString(),
});

export function createPracticeRepository(db: Db): PracticeRepository {
  const practice: Collection<PracticeDocument> = db.collection("practice");

  return {
    async listForKit(userId, kitId) {
      return (await practice.find({ userId, kitId }).toArray()).map(toRecord);
    },
    async rate(userId, kitId, cardId, confidence, at) {
      // An upsert inserts the filter's fields too, so a new record gets its userId, kitId and cardId from here.
      const doc = await practice.findOneAndUpdate(
        { userId, kitId, cardId },
        { $set: { confidence, reviewedAt: at }, $inc: { reps: 1 } },
        { upsert: true, returnDocument: "after" },
      );
      if (!doc) throw new Error("The practice record was not returned after saving it");
      return toRecord(doc);
    },
    async deleteForKit(userId, kitId) {
      return (await practice.deleteMany({ userId, kitId })).deletedCount;
    },
  };
}

/** Run once at startup. */
export async function ensurePracticeIndexes(db: Db): Promise<void> {
  // Also what makes the upsert safe: of two first ratings of the same card, one inserts and the other updates it.
  await db.collection("practice").createIndex({ userId: 1, kitId: 1, cardId: 1 }, { unique: true });
}
