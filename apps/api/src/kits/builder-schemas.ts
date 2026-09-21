import { MAX_DAYS, QUESTION_CATEGORIES } from "@prepkit/core";
import { z } from "zod";

// Shapes only. Whether a requirement id exists, or an order lists every question, depends on
// the kit, and is checked by the builder's rules where the kit is at hand.

const text = (max: number) => z.string().trim().min(1, { message: "This cannot be empty" }).max(max);
const category = z.enum(QUESTION_CATEGORIES);
const difficulty = z.int().min(1).max(3);
const ids = z.array(z.string().min(1).max(20)).max(500);

const questionFields = {
  prompt: text(1_000),
  answer_outline: text(4_000),
  difficulty,
  category,
  requirement_ids: ids,
};

export const addQuestionSchema = z.object({ ...questionFields, requirement_ids: ids.default([]) });
export const editQuestionSchema = z.object(questionFields).partial().refine((patch) => Object.keys(patch).length > 0, { message: "Nothing to change" });

const flashcardFields = { front: text(500), back: text(2_000), requirement_ids: ids };
export const addFlashcardSchema = z.object({ ...flashcardFields, requirement_ids: ids.default([]) });
export const editFlashcardSchema = z.object(flashcardFields).partial().refine((patch) => Object.keys(patch).length > 0, { message: "Nothing to change" });

export const reorderSchema = z.object({ ids });
export const pinSchema = z.object({ pinned: z.boolean() });
export const editBriefSchema = z.object({ field: z.enum(["summary", "what_they_do"]), value: text(4_000) });

export const editScheduleDaySchema = z
  .object({ focus: text(200), minutes: z.int().min(1).max(24 * 60), question_ids: ids })
  .partial()
  .refine((patch) => Object.keys(patch).length > 0, { message: "Nothing to change" });

export const regenerateSchema = z.discriminatedUnion("section", [
  z.object({ section: z.literal("questions"), category }),
  z.object({ section: z.literal("brief") }),
  z.object({ section: z.literal("schedule"), days: z.int().min(1).max(MAX_DAYS).optional() }),
]);
