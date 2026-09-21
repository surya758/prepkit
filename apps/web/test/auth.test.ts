import { describe, expect, it } from "vitest";
import { safeNext } from "@/lib/auth";

// ?next= is text in a URL, so anyone can write one. After signing in on the real site, a visitor
// must only ever be sent to a page of this app.
describe("safeNext", () => {
  it.each([["/kits/abc123"], ["/kits/abc123/practice?card=f2"], ["/kits/new#paste"]])("keeps a path inside the app: %s", (next) => {
    expect(safeNext(next)).toBe(next);
  });

  it.each([[null], [""]])("goes to the kit list when there is no next (%j)", (next) => {
    expect(safeNext(next)).toBe("/kits");
  });

  it.each([
    ["https://evil.example/login", "another site"],
    ["//evil.example", "protocol-relative: browsers read it as another host"],
    ["/\\evil.example", "a backslash some browsers turn into //"],
    ["javascript:alert(1)", "a script URL"],
    ["kits", "a relative path, which this app never produces"],
  ])("refuses %s (%s)", (next) => {
    expect(safeNext(next)).toBe("/kits");
  });
});
