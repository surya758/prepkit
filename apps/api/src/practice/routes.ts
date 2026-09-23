import { CONFIDENCE_LEVELS } from "@prepkit/core";
import { Router } from "express";
import type { RequestHandler } from "express";
import { z } from "zod";
import { currentUser } from "../middleware/require-user";
import type { PracticeService } from "./service";

// HTTP for practice mode. Every answer is the same shape — progress and the next order — so
// the interface redraws its coverage panel from whatever came back, whichever call it made.

export interface PracticeRouterDependencies {
  practice: PracticeService;
  requireUser: RequestHandler;
}

const rateSchema = z.object({ confidence: z.literal([...CONFIDENCE_LEVELS], { message: "Confidence is 1 (forgot), 2 (shaky), 3 (good) or 4 (easy)" }) });

export function createPracticeRouter({ practice, requireUser }: PracticeRouterDependencies): Router {
  const router = Router();
  router.use("/kits", requireUser);

  router.get("/kits/:id/practice", async (req, res) => {
    res.json({ practice: await practice.get(currentUser(req).id, req.params.id!) });
  });

  // PUT: rating a card says how the user feels about it now. There is one such fact per card.
  router.put("/kits/:id/practice/:cardId", async (req, res) => {
    const { confidence } = rateSchema.parse(req.body);
    res.json({ practice: await practice.rate(currentUser(req).id, req.params.id!, req.params.cardId!, confidence) });
  });

  router.delete("/kits/:id/practice", async (req, res) => {
    res.json({ practice: await practice.reset(currentUser(req).id, req.params.id!) });
  });

  return router;
}
