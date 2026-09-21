import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, api, isUnauthenticated } from "@/lib/api";

// fetch is replaced for each test; what is being tested is what api() makes of each kind of reply.
function reply(response: Response | Error) {
  const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async () => {
    if (response instanceof Error) throw response;
    return response;
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const failure = async (call: Promise<unknown>): Promise<ApiError> => call.then(() => Promise.reject(new Error("expected the call to fail")), (error) => error as ApiError);

afterEach(() => vi.unstubAllGlobals());

describe("api() — the request", () => {
  it("calls the app's own /api path, so the browser never talks to another origin", async () => {
    const fetchMock = reply(json(200, { kits: [] }));
    await api("/kits");
    expect(fetchMock.mock.calls[0]![0]).toBe("/api/kits");
  });

  it("sends a body as JSON, and says so", async () => {
    const fetchMock = reply(json(201, { user: { id: "u1" } }));
    await api("/auth/register", { method: "POST", body: { email: "ada@example.com", password: "analytical-engine" } });

    const init = fetchMock.mock.calls[0]![1]!;
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ "Content-Type": "application/json" });
    expect(JSON.parse(init.body as string)).toEqual({ email: "ada@example.com", password: "analytical-engine" });
  });

  it("sends no content type when there is no body, and keeps extra headers", async () => {
    const fetchMock = reply(json(202, { kit: {} }));
    await api("/kits/abc/retry", { method: "POST", headers: { "Idempotency-Key": "press-1" } });
    expect(fetchMock.mock.calls[0]![1]!.headers).toEqual({ "Idempotency-Key": "press-1" });
    expect(fetchMock.mock.calls[0]![1]!.body).toBeUndefined();
  });
});

describe("api() — replies", () => {
  it("returns the parsed body of a success", async () => {
    reply(json(200, { status: "ok" }));
    expect(await api("/health")).toEqual({ status: "ok" });
  });

  it("returns nothing for a 204, without trying to parse a body that is not there", async () => {
    reply(new Response(null, { status: 204 }));
    expect(await api("/auth/logout", { method: "POST" })).toBeUndefined();
  });

  it("passes the API's own error through: status, code, message", async () => {
    reply(json(409, { error: { code: "KIT_ALREADY_EXISTS", message: "You already have a kit for this job description and company", details: { kitId: "abc" } } }));
    const error = await failure(api("/kits", { method: "POST", body: {} }));

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 409, code: "KIT_ALREADY_EXISTS", message: "You already have a kit for this job description and company", details: { kitId: "abc" } });
  });

  it("offers validation problems per field, which is the shape a form needs", async () => {
    reply(
      json(400, {
        error: {
          code: "VALIDATION_FAILED",
          message: "Some fields are missing or invalid",
          details: [
            { path: "email", message: "Enter a valid email address" },
            { path: "password", message: "Use at least 8 characters" },
          ],
        },
      }),
    );
    const error = await failure(api("/auth/register", { method: "POST", body: {} }));
    expect(error.fields).toEqual({ email: "Enter a valid email address", password: "Use at least 8 characters" });
  });

  it("has no fields when the details are not a list of field problems", async () => {
    reply(json(409, { error: { code: "KIT_ALREADY_EXISTS", message: "exists", details: { kitId: "abc" } } }));
    expect((await failure(api("/kits"))).fields).toEqual({});
  });
});

describe("api() — when the reply is not the API's", () => {
  it("turns an HTML error page from a proxy or a sleeping host into a sentence someone can act on", async () => {
    reply(new Response("<html><body>502 Bad Gateway</body></html>", { status: 502, headers: { "content-type": "text/html" } }));
    const error = await failure(api("/health"));
    expect(error).toMatchObject({ status: 502, code: "SERVER_UNAVAILABLE" });
    expect(error.message).toContain("waking up");
  });

  it("does the same for JSON that is not the API's envelope", async () => {
    reply(json(500, { message: "Internal Server Error" }));
    expect(await failure(api("/health"))).toMatchObject({ status: 500, code: "SERVER_UNAVAILABLE" });
  });

  it("is not fooled by an error key that is not the API's envelope, as many servers send", async () => {
    reply(json(500, { error: "Internal Server Error" }));
    const error = await failure(api("/health"));
    expect(error).toMatchObject({ status: 500, code: "SERVER_UNAVAILABLE" });
    expect(error.message).toContain("waking up");
  });

  it("reports no connection at all as its own case", async () => {
    reply(new TypeError("Failed to fetch"));
    expect(await failure(api("/health"))).toMatchObject({ status: 0, code: "NETWORK_ERROR" });
  });

  it("lets a cancelled request stay a cancellation, not a network failure", async () => {
    reply(new DOMException("The operation was aborted.", "AbortError"));
    const error = await failure(api("/kits"));
    expect(error).not.toBeInstanceOf(ApiError);
    expect(error.name).toBe("AbortError");
  });
});

describe("isUnauthenticated", () => {
  it("recognises an ended session, and only that", () => {
    expect(isUnauthenticated(new ApiError(401, "UNAUTHENTICATED", "Sign in to continue"))).toBe(true);
    expect(isUnauthenticated(new ApiError(401, "INVALID_CREDENTIALS", "Email or password is incorrect"))).toBe(false);
    expect(isUnauthenticated(new ApiError(403, "UNAUTHENTICATED", "odd"))).toBe(false);
    expect(isUnauthenticated(new Error("UNAUTHENTICATED"))).toBe(false);
  });
});
