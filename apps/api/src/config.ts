import { z } from "zod";

// The one place the API reads the environment. Everything else receives a Config, which keeps
// the rest of the code testable and makes a missing variable fail at startup, by name, rather
// than at the first request that needs it.

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
});

export interface Config {
  env: "development" | "test" | "production";
  port: number;
  isProduction: boolean;
  /**
   * Whether company URLs on private or loopback addresses may be fetched. Never in production:
   * a deployed server must not be pointed at its own network. Derived here rather than read
   * from a flag, so there is no setting to get wrong.
   */
  allowPrivateHosts: boolean;
}

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ");
    throw new Error(`Invalid environment: ${problems}`);
  }
  const isProduction = parsed.data.NODE_ENV === "production";
  return { env: parsed.data.NODE_ENV, port: parsed.data.PORT, isProduction, allowPrivateHosts: !isProduction };
}
