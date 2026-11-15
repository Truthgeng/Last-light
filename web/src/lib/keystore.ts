/**
 * Where each person's Last Light key lives: on their own device only.
 *
 * Live mode: a "key account", a small QoreChain account the browser creates
 * from a backup phrase. Its ML-KEM-1024 key pair derives from that phrase, so
 * the phrase is the whole backup. Kept in this browser's localStorage per
 * connected address, with a backup file to download and restore.
 * Demo mode: a raw key pair, in memory.
 */
import { fromHex, kemKeyPairFromSecret, toHex, utf8, type KemKeyPair } from "@last-light/crypto";

interface StorageLike {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
}

/** A Last Light key account (live mode). */
export interface KeyAccountRecord {
  app: "last-light";
  version: 2;
  /** The person's own (QoreX EVM) address this key belongs to. */
  address: string;
  /** Backup phrase of the key account. Its ML-KEM key derives from it. */
  mnemonic: string;
  /** The key account's qor1 address, once known. */
  keyAccount?: string;
  createdAt: string;
}

/** A raw key pair (demo mode). */
interface RawKeyRecord {
  app: "last-light";
  version: 1;
  address: string;
  publicKey: string;
  secretKey: string;
  createdAt: string;
}

type KeyRecord = KeyAccountRecord | RawKeyRecord;

const PREFIX = "last-light:kem:v1:";

export function kemFromMnemonic(mnemonic: string): KemKeyPair {
  return kemKeyPairFromSecret(utf8(mnemonic.normalize("NFKD").trim()));
}

export class KeyStore {
  constructor(private readonly storage: StorageLike) {}

  private get(address: string): KeyRecord | null {
    try {
      const raw = this.storage.getItem(PREFIX + address.toLowerCase());
      return raw ? (JSON.parse(raw) as KeyRecord) : null;
    } catch {
      return null;
    }
  }

  private put(r: KeyRecord): void {
    this.storage.setItem(PREFIX + r.address.toLowerCase(), JSON.stringify(r));
  }

  load(address: string): KemKeyPair | null {
    const r = this.get(address);
    if (!r) return null;
    try {
      return r.version === 2 ? kemFromMnemonic(r.mnemonic) : { publicKey: fromHex(r.publicKey), secretKey: fromHex(r.secretKey) };
    } catch {
      return null;
    }
  }

  /** Demo mode: keep a raw key pair. */
  save(address: string, kp: KemKeyPair): void {
    this.put({
      app: "last-light",
      version: 1,
      address: address.toLowerCase(),
      publicKey: toHex(kp.publicKey),
      secretKey: toHex(kp.secretKey),
      createdAt: new Date().toISOString(),
    });
  }

  loadAccount(address: string): KeyAccountRecord | null {
    const r = this.get(address);
    return r && r.version === 2 ? r : null;
  }

  saveAccount(address: string, mnemonic: string, keyAccount?: string): KeyAccountRecord {
    const prev = this.loadAccount(address);
    const r: KeyAccountRecord = {
      app: "last-light",
      version: 2,
      address: address.toLowerCase(),
      mnemonic,
      keyAccount: keyAccount ?? prev?.keyAccount,
      createdAt: prev?.createdAt ?? new Date().toISOString(),
    };
    this.put(r);
    return r;
  }

  /** The backup file's contents. */
  backup(address: string): KeyRecord | null {
    return this.get(address);
  }

  restore(address: string, json: string): KemKeyPair {
    const r = JSON.parse(json) as KeyRecord;
    if (r.app !== "last-light" || (r.version !== 1 && r.version !== 2)) throw new Error("This is not a Last Light key backup.");
    if (r.address.toLowerCase() !== address.toLowerCase()) {
      throw new Error(`This backup belongs to ${r.address}, not the connected account.`);
    }
    this.put(r);
    const kp = this.load(address);
    if (!kp) throw new Error("This backup could not be read.");
    return kp;
  }
}

class MemoryStorage implements StorageLike {
  private m = new Map<string, string>();
  getItem(k: string) {
    return this.m.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.m.set(k, v);
  }
}

function browserStorage(): StorageLike {
  try {
    const t = "__last_light_test__";
    localStorage.setItem(t, t);
    localStorage.removeItem(t);
    return localStorage;
  } catch {
    return new MemoryStorage();
  }
}

export const liveKeys = new KeyStore(browserStorage());
export const demoKeys = new KeyStore(new MemoryStorage());
