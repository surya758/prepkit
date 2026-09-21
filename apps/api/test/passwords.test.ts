import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "../src/auth/passwords";

describe("password hashing", () => {
  it("verifies the right password and rejects a wrong one", async () => {
    const stored = await hashPassword("correct horse battery staple");
    expect(await verifyPassword("correct horse battery staple", stored)).toBe(true);
    expect(await verifyPassword("correct horse battery stapl", stored)).toBe(false);
    expect(await verifyPassword("", stored)).toBe(false);
  });

  it("never stores the password, and salts every hash", async () => {
    const first = await hashPassword("hunter2hunter2");
    const second = await hashPassword("hunter2hunter2");

    expect(first).not.toContain("hunter2");
    expect(first).not.toBe(second); // same password, different salt, different hash
    expect(await verifyPassword("hunter2hunter2", second)).toBe(true);
  });

  it("records its parameters in the hash, so they can be raised without breaking old accounts", async () => {
    const [scheme, n, r, p, salt, hash] = (await hashPassword("some password")).split("$");
    expect([scheme, n, r, p]).toEqual(["scrypt", "32768", "8", "1"]);
    expect(Buffer.from(salt!, "base64")).toHaveLength(16);
    expect(Buffer.from(hash!, "base64")).toHaveLength(32);
  });

  it("treats visually identical Unicode passwords as the same password", async () => {
    const stored = await hashPassword("café-au-lait"); // é as one code point
    expect(await verifyPassword("café-au-lait", stored)).toBe(true); // e + combining accent
  });

  it.each(["", "not-a-hash", "bcrypt$10$abc$def", "scrypt$32768$8$1$onlyfive", "scrypt$NaN$8$1$c2FsdA==$aGFzaA=="])(
    "returns false, without throwing, for an unreadable stored value: %j",
    async (stored) => {
      expect(await verifyPassword("anything", stored)).toBe(false);
    },
  );
});
