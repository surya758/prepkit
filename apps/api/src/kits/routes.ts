import { Router } from "express";
import type { Request, RequestHandler } from "express";
import { badRequest } from "../errors";
import { createRateLimit } from "../middleware/rate-limit";
import { currentUser } from "../middleware/require-user";
import type { KitRecord } from "./repository";
import { bulkCreateSchema, createKitSchema, idempotencyKeySchema } from "./schemas";
import type { KitService } from "./service";

// HTTP for kits. Every route is behind requireUser, and every service call is given the
// signed-in user's id, so nothing here can reach another person's kit.

export const KITS_PER_HOUR = 30;

export interface KitRouterDependencies {
  kits: KitService;
  requireUser: RequestHandler;
  now?: () => number;
}

/** What the interface gets. The owner's id and the fingerprint are nobody's business but the server's. */
const toView = ({ userId: _userId, fingerprint: _fingerprint, ...view }: KitRecord) => view;

function idempotencyKey(req: Request): string | undefined {
  const header = req.headers["idempotency-key"];
  if (header === undefined) return undefined;
  const parsed = idempotencyKeySchema.safeParse(Array.isArray(header) ? header[0] : header);
  if (!parsed.success) throw badRequest("INVALID_IDEMPOTENCY_KEY", parsed.error.issues[0]!.message);
  return parsed.data;
}

export function createKitRouter({ kits, requireUser, now }: KitRouterDependencies): Router {
  const router = Router();
  router.use("/kits", requireUser);

  // Each kit spends calls from a free-tier quota that every user shares.
  const limitCreation = createRateLimit({
    windowMs: 60 * 60 * 1000,
    max: KITS_PER_HOUR,
    key: (req) => currentUser(req).id,
    code: "TOO_MANY_KITS",
    message: "You have created a lot of kits in the last hour. Please try again later.",
    now,
  });

  // 202, not 201: the kit exists but is not generated yet. The interface polls GET /kits/:id.
  router.post("/kits", limitCreation, async (req, res) => {
    const body = createKitSchema.parse(req.body);
    const kit = await kits.create(currentUser(req).id, { ...body, idempotencyKey: idempotencyKey(req) });
    res.status(202).json({ kit });
  });

  // Several roles from one uploaded file. Rows succeed or fail independently.
  router.post("/kits/bulk", limitCreation, async (req, res) => {
    const { items } = bulkCreateSchema.parse(req.body);
    const results = await kits.createMany(currentUser(req).id, items);
    res.status(202).json({ results });
  });

  router.get("/kits", async (req, res) => {
    res.json({ kits: await kits.list(currentUser(req).id) });
  });

  router.get("/kits/:id", async (req, res) => {
    res.json({ kit: toView(await kits.get(currentUser(req).id, req.params.id!)) });
  });

  router.delete("/kits/:id", async (req, res) => {
    await kits.remove(currentUser(req).id, req.params.id!);
    res.status(204).end();
  });

  router.post("/kits/:id/retry", async (req, res) => {
    res.status(202).json({ kit: await kits.retry(currentUser(req).id, req.params.id!) });
  });

  return router;
}
