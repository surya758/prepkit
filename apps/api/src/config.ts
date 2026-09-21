import { z } from "zod";

// The one place the API reads the environment. Everything else receives a Config, which keeps
// the rest of the code testable and makes a missing variable fail at startup, by name, rather
// than at the first request that needs it.

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  MONGODB_URI: z
    .string({ message: "is required (see .env.example)" })
    .regex(/^mongodb(\+srv)?:\/\//, { message: "must start with mongodb:// or mongodb+srv://" }),
  // The address people open the web app at. State-changing requests from any other website
  // are refused.
  WEB_ORIGIN: z.url().default("http://localhost:3000"),
});

export interface Config {
  env: "development" | "test" | "production";
  port: number;
  mongodbUri: string;
  webOrigin: string;
  isProduction: boolean;
  /**
   * Whether company URLs on private or loopback addresses may be fetched. Never in production:
   * a deployed server must not be pointed at its own network. Derived here rather than read
   * from a flag, so there is no setting to get wrong.
   */
  allowPrivateHosts: boolean;
}

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  // `.env.example` lists optional variables with nothing after the "=". Copied as it is, that
  // sets them to an empty string, which must mean "not set" rather than "invalid".
  const provided = Object.fromEntries(Object.entries(env).filter(([, value]) => value !== undefined && value.trim() !== ""));
  const parsed = envSchema.safeParse(provided);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ");
    throw new Error(`Invalid environment: ${problems}`);
  }
  const isProduction = parsed.data.NODE_ENV === "production";
  return {
    env: parsed.data.NODE_ENV,
    port: parsed.data.PORT,
    mongodbUri: parsed.data.MONGODB_URI,
    webOrigin: new URL(parsed.data.WEB_ORIGIN).origin,
    isProduction,
    allowPrivateHosts: !isProduction,
  };
}
