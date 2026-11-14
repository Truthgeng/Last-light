/**
 * Last Light vaults: split-key inheritance.
 *
 * The owner's secret (a seed phrase, wallet instructions, anything up to
 * MAX_SECRET_BYTES) is encrypted once with a random 32-byte vault key K.
 * K is then split into two halves so that neither half says anything about K:
 *
 *   A = random 32 bytes        (the heir's half)
 *   B = K XOR A                (the guardians' half)
 *
 * - A is sealed to the heir's ML-KEM-1024 key.
 * - B is split again with Shamir sharing into one share per guardian, so that
 *   `threshold` guardians (2 by default) must act together. Each share is
 *   sealed to its guardian's ML-KEM-1024 key.
 * - The encrypted secret and all envelopes go on chain. Nothing readable does.
 *
 * Before release: the heir holds only A, each guardian only one share of B,
 * the chain only ciphertext. Nobody can open the vault, and the heir plus a
 * single guardian cannot either.
 * After release (the owner missed check-ins): each guardian opens their share
 * and re-seals it to the heir (a "handoff"). Once `threshold` handoffs are in,
 * the heir rebuilds B, then K, and decrypts the secret. AES-GCM's tag proves
 * the result is the real secret.
 *
 * The secret is padded to a fixed size so the ciphertext does not reveal
 * whether it is a 12-word or 24-word phrase.
 */
import { gcm } from "@noble/ciphers/aes.js";
import { concat, fromUtf8, randomBytes, utf8 } from "./bytes.js";
import { open, seal } from "./kem.js";
import { combineShares, splitShares } from "./shamir.js";

export const VAULT_KEY_SIZE = 32;
export const PADDED_SECRET_SIZE = 1024;
export const MAX_SECRET_BYTES = PADDED_SECRET_SIZE - 2;
const NONCE_SIZE = 12;

/** What an envelope belongs to. Every envelope is bound to all of it. */
export interface VaultContext {
  /** EVM chain id, 9800 on the QoreChain testnet. */
  chainId: number;
  /** Address of the LastLight contract, lower-case 0x hex. */
  contract: string;
  /** Vault id in that contract. */
  vaultId: bigint | number;
}

export type Role = "secret" | "heir-half" | "guardian-share" | "handoff";

/** Guardians that must act together by default. */
export const DEFAULT_THRESHOLD = 2;

/** The exact string bound to each envelope as AES-GCM associated data. */
export function contextString(ctx: VaultContext, role: Role, recipient = "", from = ""): string {
  return [
    "last-light/v1",
    `chain:${ctx.chainId}`,
    `contract:${ctx.contract.toLowerCase()}`,
    `vault:${BigInt(ctx.vaultId).toString()}`,
    `role:${role}`,
    `to:${recipient.toLowerCase()}`,
    `from:${from.toLowerCase()}`,
  ].join("|");
}

export function xor(a: Uint8Array, b: Uint8Array): Uint8Array {
  if (a.length !== b.length) throw new Error("xor: length mismatch");
  const out = new Uint8Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = a[i] ^ b[i];
  return out;
}

/** Split a vault key into two halves. Either half alone is uniformly random. */
export function splitKey(key: Uint8Array): { heirHalf: Uint8Array; guardianHalf: Uint8Array } {
  if (key.length !== VAULT_KEY_SIZE) throw new Error("splitKey: key must be 32 bytes");
  const heirHalf = randomBytes(VAULT_KEY_SIZE);
  return { heirHalf, guardianHalf: xor(key, heirHalf) };
}

export function joinKey(heirHalf: Uint8Array, guardianHalf: Uint8Array): Uint8Array {
  return xor(heirHalf, guardianHalf);
}

function pad(secret: Uint8Array): Uint8Array {
  if (secret.length === 0) throw new Error("the secret is empty");
  if (secret.length > MAX_SECRET_BYTES) throw new Error(`the secret is longer than ${MAX_SECRET_BYTES} bytes`);
  const out = new Uint8Array(PADDED_SECRET_SIZE);
  out[0] = secret.length >> 8;
  out[1] = secret.length & 0xff;
  out.set(secret, 2);
  out.set(randomBytes(PADDED_SECRET_SIZE - 2 - secret.length), 2 + secret.length);
  return out;
}

function unpad(padded: Uint8Array): Uint8Array {
  const len = (padded[0] << 8) | padded[1];
  if (len === 0 || len > MAX_SECRET_BYTES) throw new Error("unpad: bad length");
  return padded.slice(2, 2 + len);
}

export interface Recipient {
  /** 0x EVM address of the recipient's QoreChain account. */
  address: string;
  /** Their ML-KEM-1024 public key, as read from the chain. */
  kemPublicKey: Uint8Array;
}

export interface SealedVault {
  /** The secret, encrypted with the vault key: nonce (12) | ciphertext + tag. */
  encryptedSecret: Uint8Array;
  /** Half A, sealed to the heir. */
  heirEnvelope: Uint8Array;
  /** One share of half B per guardian, sealed to that guardian, in the same order as `guardians`. */
  guardianEnvelopes: Uint8Array[];
  /** Guardians that must hand off before the heir can open the vault. */
  threshold: number;
}

/** Owner side: build every encrypted piece of a vault. Runs on the owner's device. */
export function sealVault(params: {
  secret: string | Uint8Array;
  heir: Recipient;
  guardians: Recipient[];
  ctx: VaultContext;
  /** Guardians that must act together. Default 2. */
  threshold?: number;
}): SealedVault {
  const { heir, guardians, ctx } = params;
  const threshold = params.threshold ?? DEFAULT_THRESHOLD;
  if (guardians.length < 1) throw new Error("a vault needs at least one guardian");
  if (!Number.isInteger(threshold) || threshold < 1 || threshold > guardians.length) {
    throw new Error(`threshold must be between 1 and the number of guardians (${guardians.length})`);
  }
  const seen = new Set<string>();
  for (const r of [heir, ...guardians]) {
    const a = r.address.toLowerCase();
    if (seen.has(a)) throw new Error(`${r.address} is listed twice; the heir and each guardian must be different people`);
    seen.add(a);
  }
  const secret = typeof params.secret === "string" ? utf8(params.secret) : params.secret;

  const key = randomBytes(VAULT_KEY_SIZE);
  const nonce = randomBytes(NONCE_SIZE);
  const encryptedSecret = concat(nonce, gcm(key, nonce, utf8(contextString(ctx, "secret"))).encrypt(pad(secret)));

  const { heirHalf, guardianHalf } = splitKey(key);
  const heirEnvelope = seal(heir.kemPublicKey, heirHalf, contextString(ctx, "heir-half", heir.address));
  const shares = splitShares(guardianHalf, threshold, guardians.length);
  const guardianEnvelopes = guardians.map((g, i) =>
    seal(g.kemPublicKey, shares[i], contextString(ctx, "guardian-share", g.address)),
  );

  key.fill(0);
  heirHalf.fill(0);
  guardianHalf.fill(0);
  for (const s of shares) s.fill(0);
  return { encryptedSecret, heirEnvelope, guardianEnvelopes, threshold };
}

/**
 * Guardian side, after release: open your share and re-seal it to the heir.
 * The returned handoff envelope is posted to the contract, which only accepts it once the vault is released.
 */
export function guardianHandoff(params: {
  guardianAddress: string;
  guardianSecretKey: Uint8Array;
  guardianEnvelope: Uint8Array;
  heir: Recipient;
  ctx: VaultContext;
}): Uint8Array {
  const { ctx } = params;
  const share = open(
    params.guardianSecretKey,
    params.guardianEnvelope,
    contextString(ctx, "guardian-share", params.guardianAddress),
  );
  try {
    return seal(
      params.heir.kemPublicKey,
      share,
      contextString(ctx, "handoff", params.heir.address, params.guardianAddress),
    );
  } finally {
    share.fill(0);
  }
}

export interface Handoff {
  /** Address of the guardian who made it. */
  guardianAddress: string;
  envelope: Uint8Array;
}

/** Heir side, once enough guardians have handed off: rebuild the vault key and read the secret. */
export function heirRecover(params: {
  heirAddress: string;
  heirSecretKey: Uint8Array;
  heirEnvelope: Uint8Array;
  handoffs: Handoff[];
  encryptedSecret: Uint8Array;
  ctx: VaultContext;
}): string {
  const { ctx } = params;
  if (params.handoffs.length === 0) throw new Error("heirRecover: no guardian has handed off yet");
  const a = open(params.heirSecretKey, params.heirEnvelope, contextString(ctx, "heir-half", params.heirAddress));
  const shares = params.handoffs.map((h) =>
    open(params.heirSecretKey, h.envelope, contextString(ctx, "handoff", params.heirAddress, h.guardianAddress)),
  );
  const b = combineShares(shares);
  for (const s of shares) s.fill(0);
  const key = joinKey(a, b);
  a.fill(0);
  b.fill(0);
  try {
    const nonce = params.encryptedSecret.subarray(0, NONCE_SIZE);
    const ct = params.encryptedSecret.subarray(NONCE_SIZE);
    let padded: Uint8Array;
    try {
      padded = gcm(key, nonce, utf8(contextString(ctx, "secret"))).decrypt(ct);
    } catch {
      throw new Error("heirRecover: not enough guardians have handed off yet, or a handoff is wrong");
    }
    return fromUtf8(unpad(padded));
  } finally {
    key.fill(0);
  }
}
