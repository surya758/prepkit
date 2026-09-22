import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "../src/config";
import { startKeepAwake } from "../src/keep-awake";

describe("keeping the instance awake", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("asks for its own health check every interval, through the public address", () => {
    const request = vi.fn((url: string) => Promise.resolve(new Response(url)));
    const stop = startKeepAwake("https://prepkit-api.example.com", { intervalMs: 1000, fetch: request as unknown as typeof fetch, log: () => {} });
    expect(request).not.toHaveBeenCalled();
    vi.advanceTimersByTime(3000);
    expect(request).toHaveBeenCalledTimes(3);
    expect(request.mock.calls[0]?.[0]).toBe("https://prepkit-api.example.com/api/health");
    stop();
    vi.advanceTimersByTime(3000);
    expect(request).toHaveBeenCalledTimes(3);
  });

  it("carries on after a failed request", async () => {
    const request = vi.fn(() => Promise.reject(new Error("host unreachable")));
    startKeepAwake("https://prepkit-api.example.com", { intervalMs: 1000, fetch: request as unknown as typeof fetch, log: () => {} });
    vi.advanceTimersByTime(2000);
    await Promise.resolve();
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("is switched on by the address the host gives the instance, and off without it", () => {
    const base = { MONGODB_URI: "mongodb://unused/prepkit" };
    expect(loadConfig(base).publicUrl).toBeNull();
    expect(loadConfig({ ...base, RENDER_EXTERNAL_URL: "https://prepkit-api-cp9l.onrender.com" }).publicUrl).toBe("https://prepkit-api-cp9l.onrender.com");
  });
});
