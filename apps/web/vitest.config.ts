import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Tests here cover logic that needs no browser: where a redirect may go, which failures are
// retried, how an API error is read. The alias is the same "@/..." the app's own imports use.
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: { include: ["test/**/*.test.ts"] },
});
