import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { network } from "hardhat";
import { decodeEventLog, keccak256, encodeAbiParameters, getAddress, type Hex } from "viem";

import {
  generateKemKeyPair,
  guardianHandoff,
  heirRecover,
  sealVault,
  toHex,
  fromHex,
  type VaultContext,
} from "../../packages/crypto/src/index.js";

const SEED = "abandon ability able about above absent absorb abstract absurd abuse access accident";
const PERIOD = 90n * 24n * 3600n;

describe("LastLight", async () => {
  const { viem, networkHelpers } = await network.create();
  const publicClient = await viem.getPublicClient();
  const [owner, heir, g1, g2, g3, stranger] = await viem.getWalletClients();
  const chainId = await publicClient.getChainId();

  // Each person's ML-KEM-1024 key pair. In the app the public halves come from the chain's KEM registry.
  const keys = new Map(
    [heir, g1, g2, g3].map((w) => [w.account.address.toLowerCase(), generateKemKeyPair()]),
  );
  const kem = (addr: string) => keys.get(addr.toLowerCase())!;
  const recipient = (w: typeof heir) => ({ address: w.account.address, kemPublicKey: kem(w.account.address).publicKey });

  async function deploy() {
    return viem.deployContract("LastLight");
  }

  /** What the owner's browser does: predict the vault id, seal every piece to it, send createVault. */
  async function seal(ll: Awaited<ReturnType<typeof deploy>>, period = PERIOD) {
    const id = await ll.read.nextVaultId([owner.account.address]);
    const ctx: VaultContext = { chainId, contract: ll.address, vaultId: id };
    const sealed = sealVault({ secret: SEED, heir: recipient(heir), guardians: [g1, g2, g3].map(recipient), ctx });
    const hash = await ll.write.createVault(
      [
        heir.account.address,
        [g1, g2, g3].map((g) => g.account.address),
        sealed.threshold,
        period,
        toHex(sealed.encryptedSecret) as Hex,
        toHex(sealed.heirEnvelope) as Hex,
        sealed.guardianEnvelopes.map((e) => toHex(e) as Hex),
      ],
      { account: owner.account },
    );
    await publicClient.waitForTransactionReceipt({ hash });
    return { id, ctx };
  }

  /** What the heir's or a guardian's browser does: read the sealed pieces back from the logs. */
  async function readSealed(ll: Awaited<ReturnType<typeof deploy>>, id: bigint) {
    const logs = await publicClient.getContractEvents({ address: ll.address, abi: ll.abi, eventName: "VaultSealed", args: { id }, fromBlock: 0n });
    assert.equal(logs.length, 1);
    const a = logs[0].args;
    const onChain = await ll.read.getVault([id]);
    const hash = keccak256(
      encodeAbiParameters([{ type: "bytes" }, { type: "bytes" }, { type: "bytes[]" }], [a.encryptedSecret!, a.heirEnvelope!, a.guardianEnvelopes!]),
    );
    assert.equal(hash, onChain.sealedHash, "logs match the sealed hash");
    return {
      encryptedSecret: fromHex(a.encryptedSecret!),
      heirEnvelope: fromHex(a.heirEnvelope!),
      guardianEnvelopes: a.guardianEnvelopes!.map((e) => fromHex(e)),
    };
  }

  async function handoff(ll: Awaited<ReturnType<typeof deploy>>, id: bigint, ctx: VaultContext, gi: number) {
    const g = [g1, g2, g3][gi];
    const sealed = await readSealed(ll, id);
    const env = guardianHandoff({
      guardianAddress: g.account.address,
      guardianSecretKey: kem(g.account.address).secretKey,
      guardianEnvelope: sealed.guardianEnvelopes[gi],
      heir: recipient(heir),
      ctx,
    });
    return ll.write.submitHandoff([id, toHex(env) as Hex], { account: g.account });
  }

  it("full lifecycle: seal, check in, miss a check-in, two guardians hand off, heir recovers", async () => {
    const ll = await deploy();
    const { id, ctx } = await seal(ll);

    const v = await ll.read.getVault([id]);
    assert.equal(getAddress(v.owner), getAddress(owner.account.address));
    assert.equal(v.threshold, 2);
    assert.equal(await ll.read.isReleased([id]), false);

    await networkHelpers.time.increase(Number(PERIOD) - 60);
    await ll.write.checkIn([id], { account: owner.account });
    await networkHelpers.time.increase(Number(PERIOD) - 60);
    assert.equal(await ll.read.isReleased([id]), false, "check-in pushed release out");

    await networkHelpers.time.increase(120);
    assert.equal(await ll.read.isReleased([id]), true);

    await handoff(ll, id, ctx, 0);
    assert.equal(await ll.read.isOpenable([id]), false, "one guardian is not enough");
    await handoff(ll, id, ctx, 2);
    assert.equal(await ll.read.isOpenable([id]), true);

    const sealed = await readSealed(ll, id);
    const logs = await publicClient.getContractEvents({ address: ll.address, abi: ll.abi, eventName: "Handoff", args: { id }, fromBlock: 0n });
    const secret = heirRecover({
      heirAddress: heir.account.address,
      heirSecretKey: kem(heir.account.address).secretKey,
      heirEnvelope: sealed.heirEnvelope,
      handoffs: logs.map((l) => ({ guardianAddress: l.args.guardian!, envelope: fromHex(l.args.envelope!) })),
      encryptedSecret: sealed.encryptedSecret,
      ctx,
    });
    assert.equal(secret, SEED);
  });

  it("guardians cannot hand off before release", async () => {
    const ll = await deploy();
    const { id, ctx } = await seal(ll);
    await viem.assertions.revertWithCustomError(handoff(ll, id, ctx, 0), ll, "NotReleased");
  });

  it("only guardians can hand off, once each", async () => {
    const ll = await deploy();
    const { id, ctx } = await seal(ll);
    await networkHelpers.time.increase(Number(PERIOD) + 1);
    const env = toHex(new Uint8Array(1630).fill(1)) as Hex;
    await viem.assertions.revertWithCustomError(ll.write.submitHandoff([id, env], { account: stranger.account }), ll, "NotGuardian");
    await viem.assertions.revertWithCustomError(ll.write.submitHandoff([id, env], { account: heir.account }), ll, "NotGuardian");
    await handoff(ll, id, ctx, 1);
    await viem.assertions.revertWithCustomError(handoff(ll, id, ctx, 1), ll, "AlreadyHandedOff");
  });

  it("only the owner checks in or cancels, and not after release", async () => {
    const ll = await deploy();
    const { id } = await seal(ll);
    await viem.assertions.revertWithCustomError(ll.write.checkIn([id], { account: heir.account }), ll, "NotOwner");
    await viem.assertions.revertWithCustomError(ll.write.cancel([id], { account: g1.account }), ll, "NotOwner");
    await networkHelpers.time.increase(Number(PERIOD) + 1);
    await viem.assertions.revertWithCustomError(ll.write.checkIn([id], { account: owner.account }), ll, "VaultReleased");
    await viem.assertions.revertWithCustomError(ll.write.cancel([id], { account: owner.account }), ll, "VaultReleased");
  });

  it("a cancelled vault never releases", async () => {
    const ll = await deploy();
    const { id, ctx } = await seal(ll);
    await ll.write.cancel([id], { account: owner.account });
    await networkHelpers.time.increase(Number(PERIOD) * 2);
    assert.equal(await ll.read.isReleased([id]), false);
    await viem.assertions.revertWithCustomError(handoff(ll, id, ctx, 0), ll, "VaultCancelled");
  });

  it("each new vault gets a fresh id and everyone can find their vaults", async () => {
    const ll = await deploy();
    const a = await seal(ll);
    const b = await seal(ll);
    assert.notEqual(a.id, b.id);
    for (const w of [owner, heir, g1, g2, g3]) {
      assert.deepEqual(await ll.read.vaultsOf([w.account.address]), [a.id, b.id]);
    }
    assert.deepEqual(await ll.read.vaultsOf([stranger.account.address]), []);
  });

  it("rejects bad setups", async () => {
    const ll = await deploy();
    const secret = toHex(new Uint8Array(1052)) as Hex;
    const env = toHex(Uint8Array.of(1, ...new Uint8Array(1629))) as Hex;
    const gs = [g1, g2, g3].map((g) => g.account.address);
    const call = (heirAddr: Hex, guardians: Hex[], threshold: number, period: bigint, s = secret, envs = [env, env, env]) =>
      ll.write.createVault([heirAddr, guardians, threshold, period, s, env, envs], { account: owner.account });

    await viem.assertions.revertWithCustomError(call(heir.account.address, gs, 2, 60n), ll, "BadPeriod");
    await viem.assertions.revertWithCustomError(call(heir.account.address, gs, 4, PERIOD), ll, "BadThreshold");
    await viem.assertions.revertWithCustomError(call(heir.account.address, gs, 0, PERIOD), ll, "BadThreshold");
    await viem.assertions.revertWithCustomError(call(owner.account.address, gs, 2, PERIOD), ll, "BadParty");
    await viem.assertions.revertWithCustomError(call(heir.account.address, [gs[0], gs[0], gs[1]], 2, PERIOD), ll, "BadParty");
    await viem.assertions.revertWithCustomError(call(heir.account.address, [gs[0], heir.account.address, gs[1]], 2, PERIOD), ll, "BadParty");
    await viem.assertions.revertWithCustomError(call(heir.account.address, gs, 2, PERIOD, "0x1234"), ll, "BadCiphertext");
    await viem.assertions.revertWithCustomError(call(heir.account.address, gs, 2, PERIOD, secret, [env, env]), ll, "BadCiphertext");
  });
});
