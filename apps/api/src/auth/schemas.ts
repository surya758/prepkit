import { z } from "zod";

export const MIN_PASSWORD_CHARS = 8;
// A ceiling stops a megabyte-long "password" being fed to a deliberately slow hash.
export const MAX_PASSWORD_CHARS = 200;

// Emails are compared case-insensitively, so they are stored lowercased.
const email = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email({ message: "Enter a valid email address" }).max(254));

export const registerSchema = z.object({
  email,
  password: z
    .string()
    .min(MIN_PASSWORD_CHARS, { message: `Use at least ${MIN_PASSWORD_CHARS} characters` })
    .max(MAX_PASSWORD_CHARS, { message: `Use at most ${MAX_PASSWORD_CHARS} characters` }),
});

// Login does not repeat the length rule: a wrong password is a wrong password, whatever its length.
export const loginSchema = z.object({
  email,
  password: z.string().min(1, { message: "Enter your password" }).max(MAX_PASSWORD_CHARS),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
