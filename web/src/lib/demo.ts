/**
 * Demo mode: the LastLight contract's rules, in memory. The encryption is the
 * real thing (same crypto core as live mode); only the chain is simulated.
 * The people are sample personas, and the clock can be skipped forward.
 */
import { generateKemKeyPair, type Handoff } from "@last-light/crypto";
import { demoKeys } from "./keystore";
import { sameAddress, type Address, type Backend, type CreateVaultArgs, type SealedPieces, type VaultView } from "./backend";

export interface Persona {
  name: string;
  role: string;
  address: Address;
}

export const PERSONAS: Persona[] = [
  { name: "Ada", role: "Owner", address: "0xa0a0000000000000000000000000000000000a0a" },
  { name: "Tobi", role: "Heir", address: "0xb0b0000000000000000000000000000000000b0b" },
  { name: "Kemi", role: "Guardian", address: "0xc0c0000000000000000000000000000000000c0c" },
  { name: "Emeka", role: "Guardian", address: "0xd0d0000000000000000000000000000000000d0d" },
  { name: "Funmi", role: "Guardian", address: "0xe0e0000000000000000000000000000000000e0e" },
];

const MIN_PERIOD = 300n;

interface DemoVault {
  owner: Address;
  heir: Address;
  guardians: Address[];
  threshold: number;
  period: bigint;
  lastCheckIn: bigint;
  cancelled: boolean;
  sealed: SealedPieces;
  handoffs: Handoff[];
}

export class DemoBackend implements Backend {
  readonly mode = "demo" as const;
  readonly chainId = 9800;
  readonly contract: Address = "0x1a571167000000000000000000000000000d3e40";
  private offset = 0n;
  private kem = new Map<string, Uint8Array>();
  private vaults = new Map<bigint, DemoVault>();
  private nonces = new Map<string, bigint>();
  private seq = 0;

  constructor() {
    // Everyone except the owner starts with a published key, so the demo goes straight to sealing.
    for (const p of PERSONAS.slice(1)) {
      const kp = generateKemKeyPair();
      demoKeys.save(p.address, kp);
      this.kem.set(p.address.toLowerCase(), kp.publicKey);
    }
  }

  private tx(): string {
    this.seq++;
    return `demo-${this.seq.toString().padStart(4, "0")}`;
  }

  async now(): Promise<bigint> {
    return BigInt(Math.floor(Date.now() / 1000)) + this.offset;
  }

  /** Demo only: move the clock forward. */
  skip(seconds: bigint): void {
    this.offset += seconds;
  }

  async kemKeyOf(a: Address) {
    return this.kem.get(a.toLowerCase()) ?? null;
  }

  async publishKemKey(me: Address, pk: Uint8Array) {
    this.kem.set(me.toLowerCase(), pk);
    return this.tx();
  }

  async nextVaultId(owner: Address) {
    const n = this.nonces.get(owner.toLowerCase()) ?? 0n;
    return BigInt(owner) * 1000n + n + 1n;
  }

  async createVault(me: Address, a: CreateVaultArgs) {
    if (a.period < MIN_PERIOD) throw new Error("The check-in period must be at least 5 minutes.");
    if (a.threshold < 1 || a.threshold > a.guardians.length) throw new Error("Bad guardian threshold.");
    const all = [me, a.heir, ...a.guardians].map((x) => x.toLowerCase());
    if (new Set(all).size !== all.length) throw new Error("The owner, heir and each guardian must be different people.");
    const id = await this.nextVaultId(me);
    this.nonces.set(me.toLowerCase(), (this.nonces.get(me.toLowerCase()) ?? 0n) + 1n);
    this.vaults.set(id, {
      owner: me,
      heir: a.heir,
      guardians: a.guardians,
      threshold: a.threshold,
      period: a.period,
      lastCheckIn: await this.now(),
      cancelled: false,
      sealed: a.sealed,
      handoffs: [],
    });
    return this.tx();
  }

  private v(id: bigint): DemoVault {
    const v = this.vaults.get(id);
    if (!v) throw new Error("Unknown vault.");
    return v;
  }

  private async released(v: DemoVault) {
    return !v.cancelled && (await this.now()) > v.lastCheckIn + v.period;
  }

  async checkIn(me: Address, id: bigint) {
    const v = this.v(id);
    if (!sameAddress(me, v.owner)) throw new Error("Only the owner can check in.");
    if (v.cancelled) throw new Error("This vault was cancelled.");
    if (await this.released(v)) throw new Error("Too late: this vault has already been released.");
    v.lastCheckIn = await this.now();
    return this.tx();
  }

  async cancel(me: Address, id: bigint) {
    const v = this.v(id);
    if (!sameAddress(me, v.owner)) throw new Error("Only the owner can cancel.");
    if (await this.released(v)) throw new Error("Too late: this vault has already been released.");
    v.cancelled = true;
    return this.tx();
  }

  async submitHandoff(me: Address, id: bigint, envelope: Uint8Array) {
    const v = this.v(id);
    if (v.cancelled) throw new Error("This vault was cancelled.");
    if (!(await this.released(v))) throw new Error("Not released yet: the owner is still checking in.");
    if (!v.guardians.some((g) => sameAddress(g, me))) throw new Error("Only a guardian can hand off.");
    if (v.handoffs.some((h) => sameAddress(h.guardianAddress, me))) throw new Error("You already handed off.");
    v.handoffs.push({ guardianAddress: me, envelope });
    return this.tx();
  }

  async vaultsOf(a: Address) {
    const out: bigint[] = [];
    for (const [id, v] of this.vaults) {
      if ([v.owner, v.heir, ...v.guardians].some((x) => sameAddress(x, a))) out.push(id);
    }
    return out;
  }

  async getVault(id: bigint): Promise<VaultView> {
    const v = this.v(id);
    return {
      id,
      owner: v.owner,
      heir: v.heir,
      guardians: v.guardians,
      threshold: v.threshold,
      period: v.period,
      lastCheckIn: v.lastCheckIn,
      releaseAt: v.lastCheckIn + v.period,
      released: await this.released(v),
      cancelled: v.cancelled,
      handoffCount: v.handoffs.length,
      handedOff: v.guardians.map((g) => v.handoffs.some((h) => sameAddress(h.guardianAddress, g))),
    };
  }

  async sealed(id: bigint) {
    return this.v(id).sealed;
  }

  async handoffs(id: bigint) {
    return this.v(id).handoffs;
  }
}
