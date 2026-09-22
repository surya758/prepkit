// Conventional Commits, as the history has been kept by hand: `type(scope): subject`, with a
// body that says why. Enforced on every commit by the commit-msg hook (see .husky).
export default {
  extends: ["@commitlint/config-conventional"],
  rules: {
    // The scopes in use. Bare `docs:`, `chore:` and `ci:` have none.
    "scope-enum": [2, "always", ["core", "api", "web"]],
    // Subjects here are sentences, not slugs: no case rule, and long enough to say something.
    "subject-case": [0],
    "header-max-length": [2, "always", 120],
    "body-max-line-length": [0],
  },
};
