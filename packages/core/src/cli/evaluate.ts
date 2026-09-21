import { readFile, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { runBatch } from "../batch/run-batch";
import { createChainFromEnv } from "../llm/models";
import type { LlmProvider } from "../llm/provider";
import { batchOutputSchema } from "../schema/batch";
import type { BatchOutput } from "../schema/batch";

// npm run evaluate -- --input <cases.json> --output <kits.json>
//
// Reads a file of cases, runs the full pipeline on each and writes the kits to a file.
// Progress goes to stderr; the output file is the only thing written to disk.

const USAGE = "Usage: npm run evaluate -- --input <cases.json> --output <kits.json>";

const say = (line: string) => process.stderr.write(`${line}\n`);

/** Write to a temporary file and rename over the target, so a reader never sees half a file. */
async function writeAtomically(path: string, output: BatchOutput): Promise<void> {
  const temporary = `${path}.tmp`;
  await writeFile(temporary, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  await rename(temporary, path);
}

async function main(): Promise<number> {
  let args: { input?: string; output?: string };
  try {
    args = parseArgs({ options: { input: { type: "string" }, output: { type: "string" } }, allowPositionals: false }).values;
  } catch (error) {
    say(`${error instanceof Error ? error.message : error}\n${USAGE}`);
    return 2;
  }
  if (!args.input || !args.output) {
    say(USAGE);
    return 2;
  }

  // Keys come from the environment; a .env file in the working directory is a convenience.
  // loadEnvFile does not override variables that are already set.
  try {
    process.loadEnvFile(resolve(process.cwd(), ".env"));
  } catch {
    // No .env file: the environment is used as it is.
  }

  let cases: unknown;
  try {
    cases = JSON.parse(await readFile(resolve(args.input), "utf8"));
  } catch (error) {
    say(`Cannot read cases from ${args.input}: ${error instanceof Error ? error.message : error}`);
    return 2;
  }
  if (!Array.isArray(cases)) {
    say(`${args.input} must contain a JSON array of cases`);
    return 2;
  }

  // A missing key must not crash the run: every case is then recorded as failed with a
  // message that says what to set.
  let llm: LlmProvider;
  try {
    const { chain, active, skipped } = createChainFromEnv();
    llm = chain;
    say(`Models: ${active.join(" -> ")}`);
    for (const s of skipped) say(`  not used: ${s.model} (${s.reason})`);
  } catch (error) {
    say(`No model is configured: ${error instanceof Error ? error.message : error}`);
    llm = { name: "unconfigured", complete: () => Promise.reject(error) };
  }

  const outputPath = resolve(args.output);
  const started = Date.now();
  // Cases finish concurrently; saves are chained so two never write the temporary file at once.
  let saving: Promise<void> = Promise.resolve();
  const save = (snapshot: BatchOutput) => (saving = saving.then(() => writeAtomically(outputPath, snapshot)));
  say(`Running ${cases.length} case(s)...`);

  const output = await runBatch(cases, {
    llm,
    // This command is run by an operator on their own machine, and the brief serves its
    // company sites from a local address. The deployed API passes false.
    allowPrivateHosts: true,
    onCaseDone: async (entry, progress) => {
      const detail =
        entry.status === "ok"
          ? `${entry.kit.role.requirements.length} requirements, ${entry.kit.questions.length} questions, ${entry.kit.coverage.passes} pass(es), ${entry.kit.warnings?.length ?? 0} warning(s)`
          : `${entry.error.code}: ${entry.error.message}`;
      say(`[${progress.done}/${progress.total}] ${entry.id} ${entry.status} — ${detail}`);
      // Saved after every case, so a run that is interrupted still leaves valid output.
      await save(progress.output);
    },
  });

  await save(output);

  const check = batchOutputSchema.safeParse(output);
  if (!check.success) say(`Warning: the output does not match the expected structure: ${check.error.issues[0]?.message}`);

  const ok = output.kits.filter((k) => k.status === "ok").length;
  say(`Done in ${((Date.now() - started) / 1000).toFixed(1)}s: ${ok} ok, ${output.kits.length - ok} failed. Wrote ${outputPath}`);
  // A failed case is a result, not a crash, so the command still exits successfully.
  return 0;
}

main().then(
  (code) => process.exit(code),
  (error) => {
    say(`Unexpected error: ${error instanceof Error ? (error.stack ?? error.message) : error}`);
    process.exit(1);
  },
);
