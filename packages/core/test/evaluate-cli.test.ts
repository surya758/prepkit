import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { batchOutputSchema } from "../src";

// The command is run as a real child process, from a directory with no .env and with no keys
// in the environment. That exercises argument parsing, file handling and the exit code
// without a model — and "no key configured" is itself a case the command must survive.

const run = promisify(execFile);
const repoRoot = resolve(__dirname, "../../..");
const tsx = join(repoRoot, "node_modules/.bin/tsx");
const cli = join(repoRoot, "packages/core/src/cli/evaluate.ts");

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "prepkit-evaluate-"));
});
afterEach(() => rm(dir, { recursive: true, force: true }));

const evaluate = (args: string[]) =>
  run(tsx, [cli, ...args], { cwd: dir, env: { PATH: process.env.PATH, HOME: process.env.HOME } }).then(
    (r) => ({ code: 0, stderr: r.stderr }),
    (e: { code: number; stderr: string }) => ({ code: e.code, stderr: e.stderr }),
  );

describe("npm run evaluate", () => {
  it("writes a valid output file with one failed entry per case when no key is configured, and exits 0", async () => {
    const input = join(dir, "cases.json");
    const output = join(dir, "kits.json");
    await writeFile(
      input,
      JSON.stringify([
        { id: "case-01", jd: "Senior Backend Engineer\n\nWe are looking for ...", company_url: "http://localhost:8099/acme/", days: 5 },
        { id: "case-02", jd: "Another role", company_url: "", days: 2 },
      ]),
    );

    const result = await evaluate(["--input", input, "--output", output]);

    expect(result.code).toBe(0);
    expect(result.stderr).toContain("No model is configured");
    expect(result.stderr).toContain("0 ok, 2 failed");

    const written = batchOutputSchema.parse(JSON.parse(await readFile(output, "utf8")));
    expect(written.kits.map((k) => [k.id, k.status, k.error?.code])).toEqual([
      ["case-01", "failed", "LLM_NOT_CONFIGURED"],
      ["case-02", "failed", "LLM_NOT_CONFIGURED"],
    ]);
    expect(written.kits[0]!.error!.message).toContain("GEMINI_API_KEY");
  }, 30_000);

  it("explains itself and exits 2 when an argument is missing", async () => {
    const result = await evaluate(["--input", "cases.json"]);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("Usage: npm run evaluate -- --input <cases.json> --output <kits.json>");
  }, 30_000);

  it("exits 2 with a clear message when the input file is missing or is not a list", async () => {
    const missing = await evaluate(["--input", join(dir, "nope.json"), "--output", join(dir, "out.json")]);
    expect(missing.code).toBe(2);
    expect(missing.stderr).toContain("Cannot read cases from");

    const notList = join(dir, "object.json");
    await writeFile(notList, JSON.stringify({ id: "case-01" }));
    const wrongShape = await evaluate(["--input", notList, "--output", join(dir, "out.json")]);
    expect(wrongShape.code).toBe(2);
    expect(wrongShape.stderr).toContain("must contain a JSON array of cases");
  }, 30_000);
});
