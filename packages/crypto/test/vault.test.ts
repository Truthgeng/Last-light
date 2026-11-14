import { describe, expect, it } from "vitest";
import {
  assertValidKemPublicKey,
  contextString,
  generateKemKeyPair,
  guardianHandoff,
  heirRecover,
  joinKey,
  open,
  seal,
  sealVault,
  splitKey,
  splitShares,
  combineShares,
  utf8,
  fromUtf8,
  randomBytes,
  PADDED_SECRET_SIZE,
  type VaultContext,
} from "../src/index.js";

const ctx: VaultContext = { chainId: 9800, contract: "0x1111111111111111111111111111111111111111", vaultId: 7n };
const SEED = "abandon ability able about above absent absorb abstract absurd abuse access accident";

function person(address: string) {
  const kp = generateKemKeyPair();
  return { address, kp, recipient: { address, kemPublicKey: kp.publicKey } };
}

describe("envelopes", () => {
  it("seal then open returns the payload", () => {
    const r = generateKemKeyPair();
    const env = seal(r.publicKey, utf8("hello"), "ctx");
    expect(fromUtf8(open(r.secretKey, env, "ctx"))).toBe("hello");
  });

  it("a different key cannot open it", () => {
    const r = generateKemKeyPair();
    const other = generateKemKeyPair();
    const env = seal(r.publicKey, utf8("hello"), "ctx");
    expect(() => open(other.secretKey, env, "ctx")).toThrow(/not for this key/);
  });

  it("the wrong context cannot open it", () => {
    const r = generateKemKeyPair();
    const env = seal(r.publicKey, utf8("hello"), "vault 1");
    expect(() => open(r.secretKey, env, "vault 2")).toThrow();
  });

  it("a flipped byte is detected", () => {
    const r = generateKemKeyPair();
    const env = seal(r.publicKey, utf8("hello"), "ctx");
    env[env.length - 1] ^= 1;
    expect(() => open(r.secretKey, env, "ctx")).toThrow();
  });

  it("rejects keys the chain would reject", () => {
    expect(() => assertValidKemPublicKey(new Uint8Array(1568))).toThrow(/all zero/);
    expect(() => assertValidKemPublicKey(new Uint8Array(100))).toThrow(/1568/);
    expect(() => assertValidKemPublicKey(new Uint8Array(1568).fill(0xff))).toThrow(/out of range/);
  });
});

describe("key split", () => {
  it("the two halves rebuild the key and each half differs from it", () => {
    const key = randomBytes(32);
    const { heirHalf, guardianHalf } = splitKey(key);
    expect(joinKey(heirHalf, guardianHalf)).toEqual(key);
    expect(heirHalf).not.toEqual(key);
    expect(guardianHalf).not.toEqual(key);
  });
});

describe("shamir shares", () => {
  it("any threshold of the shares rebuild the secret", () => {
    const secret = randomBytes(32);
    const shares = splitShares(secret, 2, 3);
    expect(combineShares([shares[0], shares[1]])).toEqual(secret);
    expect(combineShares([shares[2], shares[0]])).toEqual(secret);
    expect(combineShares([shares[1], shares[2]])).toEqual(secret);
  });

  it("fewer than threshold shares do not rebuild it", () => {
    const secret = randomBytes(32);
    const shares = splitShares(secret, 2, 3);
    expect(combineShares([shares[0]])).not.toEqual(secret);
  });

  it("works for 3 of 5", () => {
    const secret = randomBytes(32);
    const s = splitShares(secret, 3, 5);
    expect(combineShares([s[4], s[1], s[3]])).toEqual(secret);
  });
});

describe("vault lifecycle (2 guardians must agree)", () => {
  const heir = person("0xAaAa000000000000000000000000000000000001");
  const g1 = person("0xBbBb000000000000000000000000000000000002");
  const g2 = person("0xCcCc000000000000000000000000000000000003");
  const g3 = person("0xEeEe000000000000000000000000000000000005");
  const outsider = person("0xDdDd000000000000000000000000000000000004");
  const guardians = [g1, g2, g3];

  const vault = sealVault({ secret: SEED, heir: heir.recipient, guardians: guardians.map((g) => g.recipient), ctx });

  function handoff(i: number, c: VaultContext = ctx) {
    const g = guardians[i];
    return {
      guardianAddress: g.address,
      envelope: guardianHandoff({
        guardianAddress: g.address,
        guardianSecretKey: g.kp.secretKey,
        guardianEnvelope: vault.guardianEnvelopes[i],
        heir: heir.recipient,
        ctx: c,
      }),
    };
  }

  function recover(handoffs: ReturnType<typeof handoff>[], c: VaultContext = ctx) {
    return heirRecover({
      heirAddress: heir.address,
      heirSecretKey: heir.kp.secretKey,
      heirEnvelope: vault.heirEnvelope,
      handoffs,
      encryptedSecret: vault.encryptedSecret,
      ctx: c,
    });
  }

  it("defaults to 2 guardians", () => {
    expect(vault.threshold).toBe(2);
  });

  it("full flow: two guardians hand off, the heir recovers the secret", () => {
    expect(recover([handoff(0), handoff(2)])).toBe(SEED);
    expect(recover([handoff(1), handoff(0)])).toBe(SEED);
  });

  it("the heir plus one guardian cannot open it", () => {
    expect(() => recover([handoff(0)])).toThrow(/not enough guardians/);
  });

  it("the same guardian twice does not count as two", () => {
    expect(() => recover([handoff(1), handoff(1)])).toThrow();
  });

  it("with exactly two guardians, both are needed", () => {
    const v = sealVault({ secret: SEED, heir: heir.recipient, guardians: [g1.recipient, g2.recipient], ctx });
    const h = (g: typeof g1, i: number) => ({
      guardianAddress: g.address,
      envelope: guardianHandoff({
        guardianAddress: g.address,
        guardianSecretKey: g.kp.secretKey,
        guardianEnvelope: v.guardianEnvelopes[i],
        heir: heir.recipient,
        ctx,
      }),
    });
    const args = { heirAddress: heir.address, heirSecretKey: heir.kp.secretKey, heirEnvelope: v.heirEnvelope, encryptedSecret: v.encryptedSecret, ctx };
    expect(heirRecover({ ...args, handoffs: [h(g1, 0), h(g2, 1)] })).toBe(SEED);
    expect(() => heirRecover({ ...args, handoffs: [h(g2, 1)] })).toThrow();
  });

  it("a handoff cannot be passed off as another guardian's", () => {
    const forged = { guardianAddress: g2.address, envelope: handoff(0).envelope };
    expect(() => recover([handoff(1), forged])).toThrow();
  });

  it("the secret's length is hidden", () => {
    const short = sealVault({ secret: "x", heir: heir.recipient, guardians: [g1.recipient, g2.recipient], ctx });
    expect(short.encryptedSecret.length).toBe(vault.encryptedSecret.length);
    expect(vault.encryptedSecret.length).toBe(12 + PADDED_SECRET_SIZE + 16);
  });

  it("a guardian cannot open the heir's half", () => {
    expect(() =>
      open(g1.kp.secretKey, vault.heirEnvelope, contextString(ctx, "heir-half", g1.address)),
    ).toThrow();
  });

  it("guardians together cannot open the vault without the heir's half", () => {
    // Guardians can rebuild half B, but half B alone is random and says nothing about the key.
    expect(() => open(g1.kp.secretKey, vault.heirEnvelope, contextString(ctx, "heir-half", heir.address))).toThrow();
  });

  it("an outsider cannot open anything", () => {
    expect(() => open(outsider.kp.secretKey, vault.heirEnvelope, contextString(ctx, "heir-half", heir.address))).toThrow();
    expect(() =>
      open(outsider.kp.secretKey, vault.guardianEnvelopes[0], contextString(ctx, "guardian-share", g1.address)),
    ).toThrow();
  });

  it("handoffs made for one vault do not open another", () => {
    expect(() => recover([handoff(0), handoff(1)], { ...ctx, vaultId: 8n })).toThrow();
  });

  it("refuses a bad threshold", () => {
    expect(() => sealVault({ secret: SEED, heir: heir.recipient, guardians: [g1.recipient], ctx })).toThrow(/threshold/);
    expect(() =>
      sealVault({ secret: SEED, heir: heir.recipient, guardians: [g1.recipient, g2.recipient], ctx, threshold: 3 }),
    ).toThrow(/threshold/);
  });

  it("refuses the same person as heir and guardian", () => {
    expect(() =>
      sealVault({ secret: SEED, heir: heir.recipient, guardians: [heir.recipient, g1.recipient], ctx }),
    ).toThrow(/twice/);
  });

  it("refuses an empty or oversized secret", () => {
    const gs = [g1.recipient, g2.recipient];
    expect(() => sealVault({ secret: "", heir: heir.recipient, guardians: gs, ctx })).toThrow(/empty/);
    expect(() => sealVault({ secret: "a".repeat(2000), heir: heir.recipient, guardians: gs, ctx })).toThrow(/longer/);
  });
});
