import type { Kit } from "@prepkit/core";
import { AppError, notFound } from "../errors";
import type { KitRecord, KitRepository } from "./repository";

export type ReadyKit = KitRecord & { kit: Kit };

/**
 * The user's own kit, once it has finished generating. Editing and practising both start
 * here: a kit that is queued, running or failed has nothing in it to work on.
 */
export async function findReadyKit(kits: Pick<KitRepository, "findOwned">, userId: string, kitId: string, action: "edited" | "practised"): Promise<ReadyKit> {
  const record = await kits.findOwned(kitId, userId);
  // Someone else's kit and a kit that does not exist get the same answer.
  if (!record) throw notFound("KIT_NOT_FOUND", "That kit does not exist");
  if (record.status !== "ready" || !record.kit) {
    throw new AppError(409, "KIT_NOT_READY", `This kit cannot be ${action} while it is ${record.status}`);
  }
  return record as ReadyKit;
}
