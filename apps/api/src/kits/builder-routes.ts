import { Router } from "express";
import type { Request, RequestHandler } from "express";
import { badRequest } from "../errors";
import { currentUser } from "../middleware/require-user";
import {
  addFlashcardSchema,
  addQuestionSchema,
  editBriefSchema,
  editFlashcardSchema,
  editQuestionSchema,
  editScheduleDaySchema,
  editedSchema,
  pinSchema,
  regenerateSchema,
  reorderSchema,
} from "./builder-schemas";
import type { BuilderService } from "./builder-service";
import type { KitRecord } from "./repository";

// One small request per change. The interface sends only what changed — never the whole kit —
// so a slow save cannot overwrite something edited after it was sent. Every response is the
// kit as it now stands, including `meta`, which is what the generated / edited / yours /
// pinned badges are drawn from.

export interface BuilderRouterDependencies {
  builder: BuilderService;
  requireUser: RequestHandler;
}

const toView = ({ userId: _userId, fingerprint: _fingerprint, ...view }: KitRecord) => ({ kit: view });
/** A route parameter as a single string. Express types allow repeats; these routes have none. */
const param = (req: Request, name: string): string => {
  const value = req.params[name];
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
};
const who = (req: Request) => [currentUser(req).id, param(req, "id")] as const;

export function createBuilderRouter({ builder, requireUser }: BuilderRouterDependencies): Router {
  const router = Router();
  router.use("/kits", requireUser);

  router.post("/kits/:id/questions", async (req, res) => {
    res.status(201).json(toView(await builder.addQuestion(...who(req), addQuestionSchema.parse(req.body))));
  });
  // Declared before /questions/:itemId so that "order" is not read as a question id.
  router.put("/kits/:id/questions/order", async (req, res) => {
    res.json(toView(await builder.reorderQuestions(...who(req), reorderSchema.parse(req.body).ids)));
  });
  router.patch("/kits/:id/questions/:itemId", async (req, res) => {
    res.json(toView(await builder.editQuestion(...who(req), param(req, "itemId"), editQuestionSchema.parse(req.body))));
  });
  router.delete("/kits/:id/questions/:itemId", async (req, res) => {
    res.json(toView(await builder.deleteQuestion(...who(req), param(req, "itemId"))));
  });

  router.post("/kits/:id/flashcards", async (req, res) => {
    res.status(201).json(toView(await builder.addFlashcard(...who(req), addFlashcardSchema.parse(req.body))));
  });
  router.put("/kits/:id/flashcards/order", async (req, res) => {
    res.json(toView(await builder.reorderFlashcards(...who(req), reorderSchema.parse(req.body).ids)));
  });
  router.patch("/kits/:id/flashcards/:itemId", async (req, res) => {
    res.json(toView(await builder.editFlashcard(...who(req), param(req, "itemId"), editFlashcardSchema.parse(req.body))));
  });
  router.delete("/kits/:id/flashcards/:itemId", async (req, res) => {
    res.json(toView(await builder.deleteFlashcard(...who(req), param(req, "itemId"))));
  });

  // A question or a flashcard: the id says which.
  router.put("/kits/:id/items/:itemId/pin", async (req, res) => {
    res.json(toView(await builder.setPinned(...who(req), param(req, "itemId"), pinSchema.parse(req.body).pinned)));
  });

  // After an undo has put an item back as the model wrote it, it counts as untouched again.
  router.put("/kits/:id/items/:itemId/edited", async (req, res) => {
    res.json(toView(await builder.setEdited(...who(req), param(req, "itemId"), editedSchema.parse(req.body).edited)));
  });

  router.patch("/kits/:id/brief", async (req, res) => {
    const { field, value } = editBriefSchema.parse(req.body);
    res.json(toView(await builder.editBrief(...who(req), field, value)));
  });

  router.patch("/kits/:id/schedule/days/:day", async (req, res) => {
    const day = Number(param(req, "day"));
    if (!Number.isInteger(day)) throw badRequest("VALIDATION_FAILED", "The day must be a whole number");
    res.json(toView(await builder.editScheduleDay(...who(req), day, editScheduleDaySchema.parse(req.body))));
  });

  // Regenerating questions or the brief waits for one model call, a few seconds. The
  // interface shows progress on that section only and leaves the rest of the kit editable.
  router.post("/kits/:id/regenerate", async (req, res) => {
    const body = regenerateSchema.parse(req.body);
    if (body.section === "questions") return res.json(toView(await builder.regenerateCategory(...who(req), body.category)));
    if (body.section === "brief") return res.json(toView(await builder.regenerateBrief(...who(req))));
    const { emphasised, ...record } = await builder.regenerateSchedule(...who(req), body.days, body.adaptive);
    return res.json({ ...toView(record), emphasised });
  });

  return router;
}
