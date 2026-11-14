/**
 * Where each person's ML-KEM-1024 secret key lives: on their own device only.
 * Live mode keeps it in this browser's localStorage (per address) and offers a
 * backup file. Demo mode keeps it in memory.
 */
import { fromHex, toHex, type KemKeyPair } from "@last-light/crypto";

interface StorageLike {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
}

export interface KeyBackup {
  app: "last-light";
  version: 1;
  address: string;
  publicKey: string;
  secretKey: string;
  createdAt: string;
}

const PREFIX = "last-light:kem:v1:";

export class KeyStore {
  constructor(private readonly storage: StorageLike) {}

  load(address: string): KemKeyPair | null {
    let raw: string | null = null;
    try {
      raw = this.storage.getItem(PREFIX + address.toLowerCase());
    } catch {
      return null;
    }
    if (!raw) return null;
    try {
      const b = JSON.parse(raw) as KeyBackup;
      return { publicKey: fromHex(b.publicKey), secretKey: fromHex(b.secretKey) };
    } catch {
      return null;
    }
  }

  save(address: string, kp: KemKeyPair): void {
    const b: KeyBackup = {
      app: "last-light",
      version: 1,
      address: address.toLowerCase(),
      publicKey: toHex(kp.publicKey),
      secretKey: toHex(kp.secretKey),
      createdAt: new Date().toISOString(),
    };
    this.storage.setItem(PREFIX + address.toLowerCase(), JSON.stringify(b));
  }

  backup(address: string): KeyBackup | null {
    const kp = this.load(address);
    if (!kp) return null;
    return {
      app: "last-light",
      version: 1,
      address: address.toLowerCase(),
      publicKey: toHex(kp.publicKey),
      secretKey: toHex(kp.secretKey),
      createdAt: new Date().toISOString(),
    };
  }

  restore(address: string, json: string): KemKeyPair {
    const b = JSON.parse(json) as KeyBackup;
    if (b.app !== "last-light" || b.version !== 1) throw new Error("This is not a Last Light key backup.");
    if (b.address.toLowerCase() !== address.toLowerCase()) {
      throw new Error(`This backup belongs to ${b.address}, not the connected account.`);
    }
    const kp = { publicKey: fromHex(b.publicKey), secretKey: fromHex(b.secretKey) };
    this.save(address, kp);
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
