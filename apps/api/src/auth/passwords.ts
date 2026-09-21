import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

// Passwords are hashed with scrypt from Node's own crypto module: a memory-hard function with
// no native add-on to compile, which matters on a free host with no build toolchain.
//
// The parameters travel with the hash, so they can be raised later without invalidating
// existing accounts:  scrypt$<N>$<r>$<p>$<salt>$<hash>

const N = 2 ** 15; // CPU/memory cost: about 32 MB per hash, which a 512 MB free instance can afford
const R = 8;
const P = 1;
const KEY_BYTES = 32;
const SALT_BYTES = 16;

function derive(password: string, salt: Buffer, n: number, r: number, p: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    // scrypt needs 128 * N * r bytes; Node's default ceiling is just below what N = 2^15 needs.
    scrypt(password.normalize("NFKC"), salt, KEY_BYTES, { N: n, r, p, maxmem: 256 * n * r }, (error, key) =>
      error ? reject(error) : resolve(key),
    );
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const key = await derive(password, salt, N, R, P);
  return ["scrypt", N, R, P, salt.toString("base64"), key.toString("base64")].join("$");
}

/** False for a wrong password and for a stored value it cannot read. Never throws. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, n, r, p, salt, hash] = stored.split("$");
  if (scheme !== "scrypt" || !n || !r || !p || !salt || !hash) return false;
  try {
    const expected = Buffer.from(hash, "base64");
    const actual = await derive(password, Buffer.from(salt, "base64"), Number(n), Number(r), Number(p));
    // Constant-time, so how long a wrong guess takes says nothing about how close it was.
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}
