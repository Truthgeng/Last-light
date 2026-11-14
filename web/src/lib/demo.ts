/**
 * Demo mode: the LastLight contract's rules, in memory. The encryption is the
 * real thing (same crypto core as live mode); only the chain is simulated.
 * The people are sample personas, and the clock can be skipped forward.
 */
import { kemKeyFingerprint, randomBytes, toHex, type Handoff } from "@last-light/crypto";
import { sameAddress, type Address, type Backend, type CreateVaultArgs, type SealedPieces, type TxRequest, type VaultView } from "./backend";

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

export const demoName = (a: string) => PERSONAS.find((p) => sameAddress(p.address, a))?.name ?? `${a.slice(0, 6)}…${a.slice(-4)}`;

function every(p: bigint): string {
  const d = p / 86400n;
  if (d >= 365n && d % 365n === 0n) return d === 365n ? "year" : `${d / 365n} years`;
  if (d > 0n) return `${d} days`;
  return `${p / 60n} minutes`;
}

function kb(n: number): string {
  return `${(n / 1024).toFixed(1)} KB`;
}

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
  private windows = new Set<string>();

  /**
   * Shows the approval step a real wallet would show, and resolves once the
   * person approves. Set by the app; rejects when they decline.
   */
  approver: ((req: TxRequest) => Promise<void>) | null = null;

  /** Ask for approval, then return a transaction hash. */
  private async sign(req: Omit<TxRequest, "opensWindow">): Promise<string> {
    const opensWindow = req.lane === "evm" && !this.windows.has(req.from.toLowerCase());
    if (this.approver) await this.approver({ ...req, opensWindow });
    if (opensWindow) this.windows.add(req.from.toLowerCase());
    return toHex(randomBytes(32));
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
    const tx = await this.sign({
      lane: "native",
      from: me,
      title: "Publish your Last Light key",
      summary: "Puts the public half of your ML-KEM-1024 key on QoreChain, so an owner can seal pieces of a vault to you. The private half stays on this device.",
      details: [
        ["Message", "MsgRegisterKEMKey"],
        ["Algorithm", "ML-KEM-1024 (FIPS 203)"],
        ["Public key", `${pk.length.toLocaleString()} bytes`],
        ["Fingerprint", kemKeyFingerprint(pk)],
      ],
    });
    this.kem.set(me.toLowerCase(), pk);
    return tx;
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
    const size =
      a.sealed.encryptedSecret.length + a.sealed.heirEnvelope.length + a.sealed.guardianEnvelopes.reduce((n, e) => n + e.length, 0);
    const tx = await this.sign({
      lane: "evm",
      from: me,
      title: "Seal vault",
      summary: `Stores the locked vault on chain. ${demoName(a.heir)} can open it only after you stop checking in and ${a.threshold} guardians hand off.`,
      details: [
        ["Contract call", "LastLight.createVault"],
        ["Heir", demoName(a.heir)],
        ["Guardians", `${a.guardians.map(demoName).join(", ")} (${a.threshold} must agree)`],
        ["Check in every", every(a.period)],
        ["Encrypted data", kb(size)],
        ["Readable data", "0 bytes"],
      ],
    });
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
    return tx;
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
    const next = new Date(Number((await this.now()) + v.period) * 1000);
    const tx = await this.sign({
      lane: "evm",
      from: me,
      title: "Check in",
      summary: "Tells the vault you are still here. The release date moves forward by one period.",
      details: [
        ["Contract call", "LastLight.checkIn"],
        ["Vault", `#${id.toString(16).slice(-6)}`],
        ["New release date", next.toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" })],
      ],
    });
    v.lastCheckIn = await this.now();
    return tx;
  }

  async cancel(me: Address, id: bigint) {
    const v = this.v(id);
    if (!sameAddress(me, v.owner)) throw new Error("Only the owner can cancel.");
    if (await this.released(v)) throw new Error("Too late: this vault has already been released.");
    const tx = await this.sign({
      lane: "evm",
      from: me,
      title: "Cancel vault",
      summary: "Closes this vault for good. Guardians can never hand off, and it will never release.",
      details: [
        ["Contract call", "LastLight.cancel"],
        ["Vault", `#${id.toString(16).slice(-6)}`],
      ],
    });
    v.cancelled = true;
    return tx;
  }

  async submitHandoff(me: Address, id: bigint, envelope: Uint8Array) {
    const v = this.v(id);
    if (v.cancelled) throw new Error("This vault was cancelled.");
    if (!(await this.released(v))) throw new Error("Not released yet: the owner is still checking in.");
    if (!v.guardians.some((g) => sameAddress(g, me))) throw new Error("Only a guardian can hand off.");
    if (v.handoffs.some((h) => sameAddress(h.guardianAddress, me))) throw new Error("You already handed off.");
    const tx = await this.sign({
      lane: "evm",
      from: me,
      title: "Hand off to heir",
      summary: `Sends your share of the vault key to ${demoName(v.heir)}, locked so only ${demoName(v.heir)} can open it. You never saw the secret, and you still can't.`,
      details: [
        ["Contract call", "LastLight.submitHandoff"],
        ["Vault", `#${id.toString(16).slice(-6)}`],
        ["Share sealed to", `${demoName(v.heir)} (ML-KEM-1024)`],
        ["Guardians so far", `${v.handoffs.length} of ${v.threshold} → ${v.handoffs.length + 1} of ${v.threshold}`],
      ],
    });
    v.handoffs.push({ guardianAddress: me, envelope });
    return tx;
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
