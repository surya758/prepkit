import { lookup as dnsLookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";

// Every URL we fetch comes from outside: the user typed it, or a crawled page linked to it.
// Without this check the server can be pointed at its own network (SSRF) — cloud metadata,
// a database port, an admin panel on localhost.

export type UrlRejection =
  | "INVALID_URL"
  | "UNSUPPORTED_PROTOCOL"
  | "CREDENTIALS_IN_URL"
  | "PRIVATE_ADDRESS"
  | "DNS_FAILURE";

export type UrlCheck =
  | { ok: true; url: URL }
  | { ok: false; code: UrlRejection; message: string };

export type LookupFn = (hostname: string) => Promise<{ address: string }[]>;

export interface UrlGuardOptions {
  /**
   * Set by the caller in code, never read from the environment here. The batch CLI is a
   * local operator tool and passes true (the brief serves company sites from localhost);
   * the deployed API passes false.
   */
  allowPrivateHosts: boolean;
  /** Injected in tests so they never touch the network. */
  lookup?: LookupFn;
}

const blocked = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8], // "this network"
  ["10.0.0.0", 8], // private
  ["100.64.0.0", 10], // carrier-grade NAT
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local, includes cloud metadata 169.254.169.254
  ["172.16.0.0", 12], // private
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.0.2.0", 24], // documentation
  ["192.168.0.0", 16], // private
  ["198.18.0.0", 15], // benchmarking
  ["198.51.100.0", 24], // documentation
  ["203.0.113.0", 24], // documentation
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved, includes broadcast
] as const) {
  blocked.addSubnet(network, prefix, "ipv4");
}
// No rule for IPv4-mapped addresses (::ffff:0:0/96): BlockList already checks
// ::ffff:127.0.0.1 against the IPv4 rules above, and treats plain IPv4 as mapped, so
// adding that subnet would block every IPv4 address. Both directions are tested.
for (const [network, prefix] of [
  ["::", 128], // unspecified
  ["::1", 128], // loopback
  ["64:ff9b::", 96], // NAT64: could carry a private IPv4 address past the rules above
  ["fc00::", 7], // unique local
  ["fe80::", 10], // link-local
  ["ff00::", 8], // multicast
] as const) {
  blocked.addSubnet(network, prefix, "ipv6");
}

export function isPrivateAddress(ip: string): boolean {
  const family = isIP(ip);
  if (family === 0) return false;
  return blocked.check(ip, family === 4 ? "ipv4" : "ipv6");
}

const reject = (code: UrlRejection, message: string): UrlCheck => ({
  ok: false,
  code,
  message,
});

/** The checks that need no network: syntax, scheme, credentials. */
export function parseHttpUrl(raw: string): UrlCheck {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return reject("INVALID_URL", `Not a valid URL: ${raw.slice(0, 200)}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return reject(
      "UNSUPPORTED_PROTOCOL",
      `Only http and https are fetched, got ${url.protocol}`,
    );
  }
  if (url.username || url.password) {
    return reject(
      "CREDENTIALS_IN_URL",
      "URLs with embedded credentials are not fetched",
    );
  }
  return { ok: true, url };
}

const defaultLookup: LookupFn = (hostname) =>
  dnsLookup(hostname, { all: true });

/**
 * Full check. Call it for the first URL and again for every redirect hop — a public
 * page can redirect to a private address.
 */
export async function checkUrl(
  raw: string,
  options: UrlGuardOptions,
): Promise<UrlCheck> {
  const parsed = parseHttpUrl(raw);
  if (!parsed.ok || options.allowPrivateHosts) return parsed;

  // WHATWG URL parsing has already normalised 2130706433, 0x7f.1 and 127.1 to 127.0.0.1,
  // so checking the parsed hostname covers those spellings.
  const hostname = parsed.url.hostname.replace(/^\[|\]$/g, "");
  const privateHost = () =>
    reject("PRIVATE_ADDRESS", `${hostname} is a private or loopback address`);

  if (hostname === "localhost" || hostname.endsWith(".localhost"))
    return privateHost();
  if (isIP(hostname))
    return isPrivateAddress(hostname) ? privateHost() : parsed;

  let addresses: { address: string }[];
  try {
    addresses = await (options.lookup ?? defaultLookup)(hostname);
  } catch {
    return reject("DNS_FAILURE", `Could not resolve ${hostname}`);
  }
  if (addresses.length === 0)
    return reject("DNS_FAILURE", `Could not resolve ${hostname}`);

  // Every address must be public: a name with one public and one private record is how
  // a hostile DNS server gets a second chance.
  if (addresses.some((a) => isPrivateAddress(a.address))) {
    return reject(
      "PRIVATE_ADDRESS",
      `${hostname} resolves to a private or loopback address`,
    );
  }
  return parsed;
}
