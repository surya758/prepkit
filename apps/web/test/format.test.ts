import { describe, expect, it } from "vitest";
import { formatRelative } from "@/lib/format";

const now = new Date("2026-09-21T12:00:00Z");
const ago = (ms: number) => new Date(now.getTime() - ms);
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe("formatRelative", () => {
  it.each([
    [5_000, "just now"],
    [59_000, "just now"],
    [MINUTE, "1 minute ago"],
    [3 * MINUTE + 40_000, "3 minutes ago"],
    [59 * MINUTE, "59 minutes ago"],
    [HOUR, "1 hour ago"],
    [23 * HOUR, "23 hours ago"],
    [DAY, "yesterday"],
    [6 * DAY, "6 days ago"],
  ])("%i ms ago reads as %s", (ms, expected) => {
    expect(formatRelative(ago(ms), now)).toBe(expected);
  });

  it("switches to a date after a week, which is easier to place than '23 days ago'", () => {
    expect(formatRelative(ago(23 * DAY), now)).toBe("Aug 29, 2026");
  });

  it("accepts the ISO string the API sends", () => {
    expect(formatRelative("2026-09-21T11:58:00.000Z", now)).toBe("2 minutes ago");
  });

  it("treats a clock that is slightly ahead as just now, not as the future", () => {
    expect(formatRelative(ago(-4_000), now)).toBe("just now");
  });
});
