import { describe, expect, it } from "vitest";
import { createQueryClient } from "@/components/providers";
import { ApiError } from "@/lib/api";

const ADA = { id: "u1", email: "ada@example.com" };

/** How many times the client asks before giving up on a request that always fails this way. */
async function attempts(error: Error): Promise<number> {
  const client = createQueryClient();
  let calls = 0;
  const failing = async () => {
    calls += 1;
    throw error;
  };
  await client.fetchQuery({ queryKey: ["kits"], queryFn: failing, retryDelay: 1 }).catch(() => {});
  return calls;
}

describe("which failed requests are asked again", () => {
  it.each([
    [400, "VALIDATION_FAILED"],
    [404, "KIT_NOT_FOUND"],
    [409, "KIT_ALREADY_EXISTS"],
    [429, "TOO_MANY_KITS"],
  ])("does not repeat a request the server understood and refused (%i %s)", async (status, code) => {
    expect(await attempts(new ApiError(status, code, "refused"))).toBe(1);
  });

  it.each([
    [503, "LLM_RATE_LIMITED"],
    [500, "SERVER_UNAVAILABLE"],
    [0, "NETWORK_ERROR"],
  ])("tries three times in all when waiting can help (%i %s)", async (status, code) => {
    expect(await attempts(new ApiError(status, code, "try later"))).toBe(3);
  });

  it("also retries a failure that did not come from the API client", async () => {
    expect(await attempts(new TypeError("something unexpected"))).toBe(3);
  });
});

describe("a session that has ended", () => {
  const signedIn = () => {
    const client = createQueryClient();
    client.setQueryData(["me"], ADA);
    return client;
  };
  const sessionEnded = new ApiError(401, "UNAUTHENTICATED", "Sign in to continue");

  it("marks the user as signed out when any query comes back 401 UNAUTHENTICATED", async () => {
    const client = signedIn();
    await client.fetchQuery({ queryKey: ["kits"], queryFn: () => Promise.reject(sessionEnded) }).catch(() => {});
    expect(client.getQueryData(["me"])).toBeNull();
  });

  it("does the same when it is a change, not a read, that discovers it", async () => {
    const client = signedIn();
    const rename = client.getMutationCache().build(client, { mutationFn: () => Promise.reject(sessionEnded) });
    await rename.execute(undefined).catch(() => {});
    expect(client.getQueryData(["me"])).toBeNull();
  });

  it("does not sign anyone out over a wrong password, which is also a 401", async () => {
    const client = signedIn();
    const wrongPassword = new ApiError(401, "INVALID_CREDENTIALS", "Email or password is incorrect");
    await client.fetchQuery({ queryKey: ["login"], queryFn: () => Promise.reject(wrongPassword) }).catch(() => {});
    expect(client.getQueryData(["me"])).toEqual(ADA);
  });

  it("leaves the user alone when a request fails for any other reason", async () => {
    const client = signedIn();
    await client.fetchQuery({ queryKey: ["kits"], queryFn: () => Promise.reject(new ApiError(404, "KIT_NOT_FOUND", "gone")) }).catch(() => {});
    expect(client.getQueryData(["me"])).toEqual(ADA);
  });
});
