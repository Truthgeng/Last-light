/**
 * The three things people do with a vault, built on the crypto core.
 * All encryption and decryption runs here, in the browser.
 */
import { guardianHandoff, heirRecover, sealVault, type KemKeyPair } from "@last-light/crypto";
import { ctxFor, sameAddress, type Address, type Backend } from "./backend";

async function requireKemKey(b: Backend, who: Address, role: string): Promise<Uint8Array> {
  const pk = await b.kemKeyOf(who);
  if (!pk) throw new Error(`The ${role} ${short(who)} has not published a Last Light key yet. Ask them to open Last Light and publish one.`);
  return pk;
}

export async function sealAndCreate(
  b: Backend,
  me: Address,
  p: { secret: string; heir: Address; guardians: Address[]; threshold: number; period: bigint },
): Promise<{ id: bigint; tx: string }> {
  const heirPk = await requireKemKey(b, p.heir, "heir");
  const guardianPks: Uint8Array[] = [];
  for (const [i, g] of p.guardians.entries()) guardianPks.push(await requireKemKey(b, g, `guardian ${i + 1}`));

  // Every encrypted piece is bound to the vault's id, so read it first.
  const id = await b.nextVaultId(me);
  const sealed = sealVault({
    secret: p.secret,
    heir: { address: p.heir, kemPublicKey: heirPk },
    guardians: p.guardians.map((g, i) => ({ address: g, kemPublicKey: guardianPks[i] })),
    threshold: p.threshold,
    ctx: ctxFor(b, id),
  });
  const tx = await b.createVault(me, { heir: p.heir, guardians: p.guardians, threshold: sealed.threshold, period: p.period, sealed });
  return { id, tx };
}

export async function handOff(b: Backend, me: Address, id: bigint, myKey: KemKeyPair): Promise<string> {
  const v = await b.getVault(id);
  const i = v.guardians.findIndex((g) => sameAddress(g, me));
  if (i < 0) throw new Error("You are not a guardian of this vault.");
  const pieces = await b.sealed(id);
  const heirPk = await requireKemKey(b, v.heir, "heir");
  const envelope = guardianHandoff({
    guardianAddress: me,
    guardianSecretKey: myKey.secretKey,
    guardianEnvelope: pieces.guardianEnvelopes[i],
    heir: { address: v.heir, kemPublicKey: heirPk },
    ctx: ctxFor(b, id),
  });
  return b.submitHandoff(me, id, envelope);
}

export async function openVault(b: Backend, me: Address, id: bigint, myKey: KemKeyPair): Promise<string> {
  const v = await b.getVault(id);
  if (!sameAddress(v.heir, me)) throw new Error("Only the heir can open this vault.");
  const [pieces, handoffs] = await Promise.all([b.sealed(id), b.handoffs(id)]);
  return heirRecover({
    heirAddress: me,
    heirSecretKey: myKey.secretKey,
    heirEnvelope: pieces.heirEnvelope,
    handoffs,
    encryptedSecret: pieces.encryptedSecret,
    ctx: ctxFor(b, id),
  });
}

export function short(a: string): string {
  return a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a;
}
