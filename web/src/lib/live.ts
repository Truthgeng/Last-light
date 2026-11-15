/**
 * Live mode: the LastLight contract on the QoreChain testnet.
 *
 * - Contract calls go through the QoreX wallet's EVM provider (wagmi).
 *   QoreChain admits an EVM transaction only from an account with a registered
 *   ML-DSA-87 key and an open EVM window; QoreX offers to open the window.
 * - Publishing the ML-KEM-1024 key is a native-lane message
 *   (MsgRegisterKEMKey) that QoreX signs hybrid: secp256k1 + ML-DSA-87.
 * - KEM keys are read from the chain's registry over REST, through /lcd.
 */
import { readContract, waitForTransactionReceipt, writeContract, getPublicClient } from "wagmi/actions";
import { fetchKemKey, msg, qorechainRegistry } from "@qorechain/sdk";
import { toEvmAddress } from "@qorechain/evm";
import { getQorexNative, qorexSignAndBroadcast } from "@qorechain/qorex-types";
import { fromHex, toHex } from "@last-light/crypto";
import { encodeAbiParameters, keccak256, type Hex } from "viem";
import { lastLightAbi } from "./abi";
import { config } from "./wagmi";
import type { Address, Backend, CreateVaultArgs, SealedPieces, VaultView } from "./backend";

export const NATIVE_CHAIN_ID = "qorechain-diana";
export const EVM_CHAIN_ID = 9800;
export const LCD = "/lcd";
export const EXPLORER_TX = "https://explore.qore.network/tx/";

export const LIVE_CONTRACT = (import.meta.env.VITE_LASTLIGHT_ADDRESS || "") as Address | "";
const DEPLOY_BLOCK = BigInt(import.meta.env.VITE_LASTLIGHT_DEPLOY_BLOCK || "0");

/** Where an address's KEM key can be read: the chain accepts 0x for eth-native accounts. */
export async function readKemKey(address: string): Promise<Uint8Array | null> {
  const r = await fetchKemKey({ rest: `${location.origin}${LCD}`, address });
  return r.found && r.key ? r.key.publicKey : null;
}

export class LiveBackend implements Backend {
  readonly mode = "live" as const;
  readonly chainId = EVM_CHAIN_ID;
  constructor(readonly contract: Address) {}

  private client() {
    const c = getPublicClient(config, { chainId: EVM_CHAIN_ID });
    if (!c) throw new Error("No connection to the QoreChain testnet.");
    return c;
  }

  private async write(functionName: string, args: readonly unknown[], me: Address): Promise<string> {
    const hash = await writeContract(config, {
      address: this.contract,
      abi: lastLightAbi,
      functionName: functionName as never,
      args: args as never,
      account: me,
      chainId: EVM_CHAIN_ID,
    });
    const r = await waitForTransactionReceipt(config, { hash, chainId: EVM_CHAIN_ID });
    if (r.status !== "success") throw new Error(`The transaction failed on chain (${hash}).`);
    return hash;
  }

  private read<T>(functionName: string, args: readonly unknown[]): Promise<T> {
    return readContract(config, {
      address: this.contract,
      abi: lastLightAbi,
      functionName: functionName as never,
      args: args as never,
      chainId: EVM_CHAIN_ID,
    }) as Promise<T>;
  }

  async now() {
    const b = await this.client().getBlock();
    return b.timestamp;
  }

  /**
   * An account's ML-KEM-1024 key. Eth-native accounts publish it under their own 0x address.
   * Classic QoreX accounts (different keys on the native and EVM sides) publish it under their
   * qor1 address and link that address to their EVM side in the contract.
   */
  async kemKeyOf(a: Address) {
    const direct = await readKemKey(a);
    if (direct) return direct;
    const native = await this.read<string>("nativeAddressOf", [a]);
    return native ? readKemKey(native) : null;
  }

  async publishKemKey(me: Address, publicKey: Uint8Array) {
    const native = getQorexNative();
    if (!native) throw new Error("QoreX was not found. Install the QoreX extension, switch it to Testnet and reload.");
    const key = await native.getKey(NATIVE_CHAIN_ID);
    const encoded = qorechainRegistry().encode(msg.pqc.registerKemKey({ sender: key.bech32Address, publicKey }));
    const r = await qorexSignAndBroadcast({
      chainId: NATIVE_CHAIN_ID,
      messages: [{ typeUrl: "/qorechain.pqc.v1.MsgRegisterKEMKey", value: encoded }],
      memo: "Last Light: publish ML-KEM-1024 key",
    });
    if (r.code !== 0) throw new Error(`QoreChain refused the key (code ${r.code}, tx ${r.txHash}).`);
    // Different keys on the two sides: tell the contract where this account's key lives.
    if (toEvmAddress(key.bech32Address) !== me.toLowerCase()) {
      const current = await this.read<string>("nativeAddressOf", [me]);
      if (current !== key.bech32Address) await this.write("linkNative", [key.bech32Address], me);
    }
    return r.txHash;
  }

  nextVaultId(owner: Address) {
    return this.read<bigint>("nextVaultId", [owner]);
  }

  createVault(me: Address, a: CreateVaultArgs) {
    return this.write(
      "createVault",
      [
        a.heir,
        a.guardians,
        a.threshold,
        a.period,
        toHex(a.sealed.encryptedSecret),
        toHex(a.sealed.heirEnvelope),
        a.sealed.guardianEnvelopes.map((e) => toHex(e)),
      ],
      me,
    );
  }

  checkIn(me: Address, id: bigint) {
    return this.write("checkIn", [id], me);
  }

  cancel(me: Address, id: bigint) {
    return this.write("cancel", [id], me);
  }

  submitHandoff(me: Address, id: bigint, envelope: Uint8Array) {
    return this.write("submitHandoff", [id, toHex(envelope)], me);
  }

  vaultsOf(a: Address) {
    return this.read<bigint[]>("vaultsOf", [a]).then((x) => [...x]);
  }

  async getVault(id: bigint): Promise<VaultView> {
    const [v, released] = await Promise.all([
      this.read<{
        owner: Address;
        period: bigint;
        lastCheckIn: bigint;
        threshold: number;
        handoffCount: number;
        cancelled: boolean;
        heir: Address;
        guardians: readonly Address[];
      }>("getVault", [id]),
      this.read<boolean>("isReleased", [id]),
    ]);
    const handedOff = await Promise.all(v.guardians.map((g) => this.read<boolean>("handedOff", [id, g])));
    return {
      id,
      owner: v.owner,
      heir: v.heir,
      guardians: [...v.guardians],
      threshold: Number(v.threshold),
      period: v.period,
      lastCheckIn: v.lastCheckIn,
      releaseAt: v.lastCheckIn + v.period,
      released,
      cancelled: v.cancelled,
      handoffCount: Number(v.handoffCount),
      handedOff,
    };
  }

  async sealed(id: bigint): Promise<SealedPieces> {
    const logs = await this.client().getContractEvents({
      address: this.contract,
      abi: lastLightAbi,
      eventName: "VaultSealed",
      args: { id },
      fromBlock: DEPLOY_BLOCK,
    });
    if (logs.length !== 1) throw new Error("Could not find this vault's sealed pieces in the chain logs.");
    const a = logs[0].args as { encryptedSecret: Hex; heirEnvelope: Hex; guardianEnvelopes: readonly Hex[] };
    // Check the logs against the hash the contract stored when the vault was sealed.
    const onChain = await this.read<{ sealedHash: Hex }>("getVault", [id]);
    const hash = keccak256(
      encodeAbiParameters(
        [{ type: "bytes" }, { type: "bytes" }, { type: "bytes[]" }],
        [a.encryptedSecret, a.heirEnvelope, [...a.guardianEnvelopes]],
      ),
    );
    if (hash !== onChain.sealedHash) throw new Error("The sealed pieces in the logs do not match the vault. Refusing to use them.");
    return {
      encryptedSecret: fromHex(a.encryptedSecret),
      heirEnvelope: fromHex(a.heirEnvelope),
      guardianEnvelopes: a.guardianEnvelopes.map((e) => fromHex(e)),
    };
  }

  async handoffs(id: bigint) {
    const logs = await this.client().getContractEvents({
      address: this.contract,
      abi: lastLightAbi,
      eventName: "Handoff",
      args: { id },
      fromBlock: DEPLOY_BLOCK,
    });
    return logs.map((l) => {
      const a = l.args as { guardian: Address; envelope: Hex };
      return { guardianAddress: a.guardian, envelope: fromHex(a.envelope) };
    });
  }
}
