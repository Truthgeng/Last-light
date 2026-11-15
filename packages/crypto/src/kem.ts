/**
 * ML-KEM-1024 key pairs and "sealed envelopes".
 *
 * A sealed envelope is data encrypted to one recipient's ML-KEM-1024 public
 * key (the key they publish on QoreChain with `msg.pqc.registerKemKey`):
 *
 *   1. ML-KEM-1024 encapsulate to the recipient's key -> shared secret + KEM ciphertext
 *   2. HKDF-SHA256(shared secret) -> one-time AES-256-GCM key
 *   3. AES-256-GCM encrypt the payload, with a context string as associated data
 *
 * Envelope layout: version (1) | KEM ciphertext (1568) | nonce (12) | AES-GCM ciphertext + tag
 *
 * The context binds an envelope to one vault, one role and one recipient, so an
 * envelope cannot be lifted out of one vault and replayed in another.
 * Everything here runs on the user's device; nothing secret leaves it.
 */
import { ml_kem1024 } from "@noble/post-quantum/ml-kem.js";
import { gcm } from "@noble/ciphers/aes.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { concat, randomBytes, utf8 } from "./bytes.js";

export const ENVELOPE_VERSION = 1;
export const ML_KEM_1024_PUBLIC_KEY_SIZE = 1568;
export const ML_KEM_1024_SECRET_KEY_SIZE = 3168;
export const ML_KEM_1024_CIPHERTEXT_SIZE = 1568;
const NONCE_SIZE = 12;
const TAG_SIZE = 16;
const HKDF_INFO = utf8("last-light/v1/envelope");

export interface KemKeyPair {
  /** 1568 bytes. Published on chain. */
  publicKey: Uint8Array;
  /** 3168 bytes. Never leaves the device. */
  secretKey: Uint8Array;
}

/** New ML-KEM-1024 key pair. Pass a 64-byte seed only for tests or deterministic recovery. */
export function generateKemKeyPair(seed?: Uint8Array): KemKeyPair {
  if (seed && seed.length !== 64) throw new Error("generateKemKeyPair: seed must be 64 bytes");
  const { publicKey, secretKey } = ml_kem1024.keygen(seed);
  return { publicKey, secretKey };
}

/**
 * Deterministic ML-KEM-1024 key pair from a secret, such as a backup phrase.
 * The same secret always gives the same key pair, so the secret is the backup.
 */
export function kemKeyPairFromSecret(secret: Uint8Array): KemKeyPair {
  if (secret.length < 16) throw new Error("kemKeyPairFromSecret: secret too short");
  const seed = hkdf(sha256, secret, utf8("last-light/v1"), utf8("ml-kem-1024 key seed"), 64);
  try {
    return generateKemKeyPair(seed);
  } finally {
    seed.fill(0);
  }
}

/**
 * Same check the chain runs in `registerKemKey` (FIPS 203 modulus check):
 * exactly 1568 bytes, every 12-bit coefficient of t_hat below 3329, t_hat not all zero.
 * We run it before encrypting to a key read from the chain.
 */
export function assertValidKemPublicKey(pk: Uint8Array): void {
  if (!(pk instanceof Uint8Array) || pk.length !== ML_KEM_1024_PUBLIC_KEY_SIZE) {
    throw new Error(`not an ML-KEM-1024 public key: expected ${ML_KEM_1024_PUBLIC_KEY_SIZE} bytes`);
  }
  let zero = true;
  for (let i = 0; i < 4 * 384; i += 3) {
    const c0 = pk[i] | ((pk[i + 1] & 0x0f) << 8);
    const c1 = (pk[i + 1] >> 4) | (pk[i + 2] << 4);
    if (c0 >= 3329 || c1 >= 3329) throw new Error("not an ML-KEM-1024 public key: coefficient out of range");
    if (pk[i] | pk[i + 1] | pk[i + 2]) zero = false;
  }
  if (zero) throw new Error("not an ML-KEM-1024 public key: t_hat is all zero");
}

/** Short fingerprint of a public key, for showing in the UI so users can compare keys. */
export function kemKeyFingerprint(pk: Uint8Array): string {
  const h = sha256(pk).slice(0, 8);
  return Array.from(h, (b) => b.toString(16).padStart(2, "0")).join("").replace(/(.{4})(?!$)/g, "$1-");
}

function deriveKey(sharedSecret: Uint8Array, kemCiphertext: Uint8Array): Uint8Array {
  // Salt with the KEM ciphertext so every envelope gets its own key even if a shared secret repeated.
  return hkdf(sha256, sharedSecret, sha256(kemCiphertext), HKDF_INFO, 32);
}

/** Encrypt `payload` so only the holder of `recipientPublicKey`'s secret key can read it. */
export function seal(recipientPublicKey: Uint8Array, payload: Uint8Array, context: string): Uint8Array {
  assertValidKemPublicKey(recipientPublicKey);
  const { cipherText: kemCt, sharedSecret } = ml_kem1024.encapsulate(recipientPublicKey);
  const key = deriveKey(sharedSecret, kemCt);
  const nonce = randomBytes(NONCE_SIZE);
  const ct = gcm(key, nonce, utf8(context)).encrypt(payload);
  key.fill(0);
  sharedSecret.fill(0);
  return concat(Uint8Array.of(ENVELOPE_VERSION), kemCt, nonce, ct);
}

/** Decrypt an envelope with the recipient's secret key. Throws if the key, context or data is wrong. */
export function open(secretKey: Uint8Array, envelope: Uint8Array, context: string): Uint8Array {
  const min = 1 + ML_KEM_1024_CIPHERTEXT_SIZE + NONCE_SIZE + TAG_SIZE;
  if (envelope.length < min) throw new Error("open: envelope too short");
  if (envelope[0] !== ENVELOPE_VERSION) throw new Error(`open: unknown envelope version ${envelope[0]}`);
  const kemCt = envelope.subarray(1, 1 + ML_KEM_1024_CIPHERTEXT_SIZE);
  const nonce = envelope.subarray(1 + ML_KEM_1024_CIPHERTEXT_SIZE, 1 + ML_KEM_1024_CIPHERTEXT_SIZE + NONCE_SIZE);
  const ct = envelope.subarray(1 + ML_KEM_1024_CIPHERTEXT_SIZE + NONCE_SIZE);
  // ML-KEM decapsulation never fails outright: a wrong key yields a wrong secret,
  // which AES-GCM then rejects. That is the check.
  const sharedSecret = ml_kem1024.decapsulate(kemCt, secretKey);
  const key = deriveKey(sharedSecret, kemCt);
  try {
    return gcm(key, nonce, utf8(context)).decrypt(ct);
  } catch {
    throw new Error("open: this envelope is not for this key, or it was tampered with");
  } finally {
    key.fill(0);
    sharedSecret.fill(0);
  }
}
