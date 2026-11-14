/**
 * What the app needs from "the chain". Two implementations:
 * - live.ts: the LastLight contract on the QoreChain testnet, through QoreX
 * - demo.ts: the same rules, in memory, with sample people and a clock you can skip
 */
import type { Handoff, VaultContext } from "@last-light/crypto";

export type Address = `0x${string}`;

export interface VaultView {
  id: bigint;
  owner: Address;
  heir: Address;
  guardians: Address[];
  threshold: number;
  period: bigint;
  lastCheckIn: bigint;
  releaseAt: bigint;
  released: boolean;
  cancelled: boolean;
  handoffCount: number;
  /** Per guardian, same order as `guardians`. */
  handedOff: boolean[];
}

export interface SealedPieces {
  encryptedSecret: Uint8Array;
  heirEnvelope: Uint8Array;
  guardianEnvelopes: Uint8Array[];
}

export interface CreateVaultArgs {
  heir: Address;
  guardians: Address[];
  threshold: number;
  period: bigint;
  sealed: SealedPieces;
}

export interface Backend {
  readonly mode: "live" | "demo";
  readonly chainId: number;
  readonly contract: Address;
  /** Chain time in seconds. */
  now(): Promise<bigint>;
  /** The ML-KEM-1024 public key an address published, or null. */
  kemKeyOf(address: Address): Promise<Uint8Array | null>;
  /** Publish `me`'s ML-KEM-1024 public key. Returns a transaction hash or demo id. */
  publishKemKey(me: Address, publicKey: Uint8Array): Promise<string>;
  nextVaultId(owner: Address): Promise<bigint>;
  createVault(me: Address, args: CreateVaultArgs): Promise<string>;
  checkIn(me: Address, id: bigint): Promise<string>;
  cancel(me: Address, id: bigint): Promise<string>;
  submitHandoff(me: Address, id: bigint, envelope: Uint8Array): Promise<string>;
  vaultsOf(address: Address): Promise<bigint[]>;
  getVault(id: bigint): Promise<VaultView>;
  sealed(id: bigint): Promise<SealedPieces>;
  handoffs(id: bigint): Promise<Handoff[]>;
}

export function ctxFor(b: Backend, id: bigint): VaultContext {
  return { chainId: b.chainId, contract: b.contract.toLowerCase(), vaultId: id };
}

export const sameAddress = (a?: string, b?: string) => !!a && !!b && a.toLowerCase() === b.toLowerCase();
