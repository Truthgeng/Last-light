/**
 * Shamir secret sharing over GF(2^8), used to split the guardians' half of the
 * vault key so that `threshold` guardians must act together to release it.
 * Any `threshold - 1` shares reveal nothing about the half.
 *
 * Share layout: x (1 byte, 1..255) | y (same length as the secret)
 */
import { randomBytes } from "./bytes.js";

// GF(2^8) with the AES polynomial x^8 + x^4 + x^3 + x + 1 (0x11b), generator 3.
const EXP = new Uint8Array(510);
const LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x ^= (x << 1) ^ (x & 0x80 ? 0x11b : 0); // multiply by 3
    x &= 0xff;
  }
  for (let i = 255; i < 510; i++) EXP[i] = EXP[i - 255];
})();

function mul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return EXP[LOG[a] + LOG[b]];
}

function div(a: number, b: number): number {
  if (b === 0) throw new Error("gf256: division by zero");
  if (a === 0) return 0;
  return EXP[LOG[a] + 255 - LOG[b]];
}

/** Split `secret` into `count` shares, any `threshold` of which rebuild it. */
export function splitShares(secret: Uint8Array, threshold: number, count: number): Uint8Array[] {
  if (!Number.isInteger(threshold) || threshold < 1) throw new Error("splitShares: threshold must be at least 1");
  if (!Number.isInteger(count) || count < threshold || count > 255) {
    throw new Error("splitShares: count must be between threshold and 255");
  }
  const shares = Array.from({ length: count }, (_, i) => {
    const s = new Uint8Array(1 + secret.length);
    s[0] = i + 1;
    return s;
  });
  const coeffs = new Uint8Array(threshold);
  for (let byte = 0; byte < secret.length; byte++) {
    coeffs[0] = secret[byte];
    coeffs.set(randomBytes(threshold - 1), 1);
    for (const share of shares) {
      const x = share[0];
      // Horner's rule: evaluate the polynomial at x.
      let y = 0;
      for (let k = threshold - 1; k >= 0; k--) y = mul(y, x) ^ coeffs[k];
      share[1 + byte] = y;
    }
  }
  coeffs.fill(0);
  return shares;
}

/** Rebuild the secret from at least `threshold` distinct shares (Lagrange interpolation at x = 0). */
export function combineShares(shares: Uint8Array[]): Uint8Array {
  if (shares.length === 0) throw new Error("combineShares: no shares");
  const len = shares[0].length;
  const xs = new Set<number>();
  for (const s of shares) {
    if (s.length !== len || len < 2) throw new Error("combineShares: shares have different lengths");
    if (s[0] === 0 || xs.has(s[0])) throw new Error("combineShares: duplicate or invalid share index");
    xs.add(s[0]);
  }
  const out = new Uint8Array(len - 1);
  for (let byte = 0; byte < len - 1; byte++) {
    let acc = 0;
    for (let i = 0; i < shares.length; i++) {
      const xi = shares[i][0];
      let num = 1;
      let den = 1;
      for (let j = 0; j < shares.length; j++) {
        if (i === j) continue;
        const xj = shares[j][0];
        num = mul(num, xj); // (0 - xj) = xj in GF(2^8)
        den = mul(den, xi ^ xj);
      }
      acc ^= mul(shares[i][1 + byte], div(num, den));
    }
    out[byte] = acc;
  }
  return out;
}
