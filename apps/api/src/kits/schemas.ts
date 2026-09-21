import { MAX_DAYS } from "@prepkit/core";
import { z } from "zod";

export const MAX_JD_INPUT_CHARS = 50_000;
export const MAX_BULK_ITEMS = 10;

export const createKitSchema = z.object({
  jd: z
    .string({ message: "Paste the job description" })
    .trim()
    .min(1, { message: "Paste the job description" })
    .max(MAX_JD_INPUT_CHARS, { message: `The job description is too long (${MAX_JD_INPUT_CHARS.toLocaleString("en")} characters at most)` }),
  // Deliberately not validated as a URL. A bad address costs the kit its company research,
  // not its existence, and the kit will say so.
  companyUrl: z.string().trim().max(2_000).default(""),
  days: z
    .number({ message: "Enter the number of days until the interview" })
    .int({ message: "Days must be a whole number" })
    .min(1, { message: "Days must be at least 1" })
    .max(MAX_DAYS, { message: `Days must be at most ${MAX_DAYS}` }),
  force: z.boolean().optional(),
});

// Each item is validated on its own, so one bad row in an uploaded file does not reject the rest.
export const bulkCreateSchema = z.object({
  items: z
    .array(z.unknown())
    .min(1, { message: "The file contains no roles" })
    .max(MAX_BULK_ITEMS, { message: `Upload at most ${MAX_BULK_ITEMS} roles at a time` }),
});

// Opaque to the server: long enough not to collide, short enough not to be abused.
export const idempotencyKeySchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{8,128}$/, { message: "Idempotency-Key must be 8 to 128 letters, digits, hyphens or underscores" });

export type CreateKitBody = z.infer<typeof createKitSchema>;
