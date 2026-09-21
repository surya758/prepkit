// Reading an uploaded cases file: the same shape `npm run evaluate` takes, a JSON list of
// { id, jd, company_url, days }. This decides only whether the FILE can be used. Whether each
// role in it is valid is the API's decision, reported per row, so the two never disagree.

/** The API accepts this many roles at a time; each one spends calls from a shared free quota. */
export const MAX_ROLES_PER_FILE = 10;
/** Comfortably under the API's 1 MB request limit once re-encoded. */
export const MAX_FILE_BYTES = 900_000;

export interface ParsedCases {
  /** What is sent, in file order. A row that is not an object is sent as it is, for the API to refuse by number. */
  items: unknown[];
  /** What to call each row in the results: its id when it has one, otherwise its position. */
  labels: string[];
}

export type CasesFileResult = { ok: true; cases: ParsedCases } | { ok: false; message: string };

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

export function parseCasesFile(text: string): CasesFileResult {
  if (new TextEncoder().encode(text).length > MAX_FILE_BYTES) {
    return { ok: false, message: "That file is too large. Keep it under 900 KB, or split it into smaller files." };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, message: "That file is not valid JSON." };
  }

  // Both the bare list the batch command reads and { "cases": [...] } are accepted.
  const rows = Array.isArray(parsed) ? parsed : isObject(parsed) && Array.isArray(parsed.cases) ? parsed.cases : null;
  if (!rows) return { ok: false, message: 'Expected a list of roles: [{ "jd": "...", "company_url": "...", "days": 7 }]' };
  if (rows.length === 0) return { ok: false, message: "That file contains no roles." };
  if (rows.length > MAX_ROLES_PER_FILE) {
    return { ok: false, message: `That file has ${rows.length} roles. Upload at most ${MAX_ROLES_PER_FILE} at a time.` };
  }

  return {
    ok: true,
    cases: {
      items: rows.map((row: unknown) => {
        if (!isObject(row)) return row;
        // The file says company_url, as the brief's format does; the API says companyUrl.
        return { jd: row.jd, companyUrl: row.company_url ?? row.companyUrl, days: row.days };
      }),
      labels: rows.map((row: unknown, index: number) => (isObject(row) && typeof row.id === "string" && row.id.trim() ? row.id.trim() : `Row ${index + 1}`)),
    },
  };
}
