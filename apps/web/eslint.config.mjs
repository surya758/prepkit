import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // Only what is bundled for the browser. Tests run in Node and may call core's real rules,
    // which is how the browser's copies of them are checked against the originals.
    files: ["src/**"],
    // @prepkit/core is the pipeline: it crawls, resolves DNS and calls models, none of which
    // can run in a browser. The web app shares its TYPES, so the two never disagree about what
    // a kit is, and type imports are erased before bundling. Importing its code is an error.
    rules: {
      "@typescript-eslint/no-restricted-imports": [
        "error",
        { paths: [{ name: "@prepkit/core", message: "Import types only: import type { Kit } from \"@prepkit/core\".", allowTypeImports: true }] },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
