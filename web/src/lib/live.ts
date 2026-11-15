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
import { readContract, waitForTransactionReceipt, getPublicClient, getAccount } from "wagmi/actions";
import {
  EthNativeSigner,
  buildRegisterPqcKeyMsg,
  deriveUnifiedAccount,
  fetchKemKey,
  fetchPqcStatus,
  generateMnemonic,
  msg,
  signProofOfPossession,
  type UnifiedAccount,
} from "@qorechain/sdk";
import { equalBytes, fromHex, toHex } from "@last-light/crypto";
import { encodeAbiParameters, encodeFunctionData, keccak256, numberToHex, parseEther, type Hex } from "viem";
import { kemFromMnemonic, type KeyStore } from "./keystore";
import { lastLightAbi } from "./abi";
import { config } from "./wagmi";
import type { Address, Backend, CreateVaultArgs, SealedPieces, VaultView } from "./backend";

/** Funding for a new key account: covers its two setup transactions (0.1 QOR fee each). */
const KEY_ACCOUNT_FUNDING = "0.5";
const MIN_KEY_ACCOUNT_UQOR = 250_000n;
const NATIVE_FEE = { amount: [{ denom: "uqor", amount: "100000" }], gas: "800000" };

const lcd = () => `${location.origin}${LCD}`;

interface Eip1193 {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
}

/**
 * Send a transaction with plain eth_sendTransaction on the connected wallet's own provider.
 * Newer viem tries wallet_sendTransaction first, which QoreX does not support yet and refuses
 * without the error code that would make viem fall back, so go straight to the standard method.
 */
async function sendTx(from: Address, tx: { to: Address; data?: Hex; value?: bigint }): Promise<Hex> {
  const { connector, address } = getAccount(config);
  if (!connector || !address) throw new Error("Connect QoreX first.");
  if (address.toLowerCase() !== from.toLowerCase()) throw new Error("The connected account changed. Reload the page.");
  const provider = (await connector.getProvider()) as Eip1193;
  const params: Record<string, string> = { from: address, to: tx.to };
  if (tx.data) params.data = tx.data;
  if (tx.value) params.value = numberToHex(tx.value);
  return (await provider.request({ method: "eth_sendTransaction", params: [params] })) as Hex;
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function lcdJson<T>(path: string, init?: RequestInit): Promise<{ status: number; body: T }> {
  const res = await fetch(`${lcd()}${path}`, init);
  let body: T;
  try {
    body = (await res.json()) as T;
  } catch {
    body = {} as T;
  }
  return { status: res.status, body };
}

async function uqorBalance(addr: string): Promise<bigint> {
  const { body } = await lcdJson<{ balance?: { amount?: string } }>(`/cosmos/bank/v1beta1/balances/${addr}/by_denom?denom=uqor`);
  return BigInt(body.balance?.amount ?? "0");
}

async function accountSequence(addr: string): Promise<{ accountNumber: bigint; sequence: bigint }> {
  const { status, body } = await lcdJson<{ account?: Record<string, unknown> }>(`/cosmos/auth/v1beta1/accounts/${addr}`);
  if (status === 404) throw new Error("The key account does not exist on chain yet. Fund it first.");
  const acc = ((body.account as Record<string, unknown>)?.base_account ?? body.account ?? {}) as Record<string, string>;
  return { accountNumber: BigInt(acc.account_number ?? "0"), sequence: BigInt(acc.sequence ?? "0") };
}

/** Broadcasts native-lane transactions through the /lcd relay and waits for them to land in a block. */
const restBroadcaster = {
  async broadcastTx(tx: Uint8Array) {
    let b64 = "";
    for (const x of tx) b64 += String.fromCharCode(x);
    const { body } = await lcdJson<{ tx_response?: { code: number; txhash: string; raw_log?: string } }>("/cosmos/tx/v1beta1/txs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tx_bytes: btoa(b64), mode: "BROADCAST_MODE_SYNC" }),
    });
    const r = body.tx_response;
    if (!r) throw new Error("QoreChain did not accept the transaction.");
    if (r.code !== 0) return { code: r.code, transactionHash: r.txhash, rawLog: r.raw_log };
    for (let i = 0; i < 40; i++) {
      await sleep(1500);
      const q = await lcdJson<{ tx_response?: { code: number; height: string; raw_log?: string } }>(`/cosmos/tx/v1beta1/txs/${r.txhash}`);
      if (q.status === 200 && q.body.tx_response) {
        return { code: q.body.tx_response.code, transactionHash: r.txhash, height: Number(q.body.tx_response.height), rawLog: q.body.tx_response.raw_log };
      }
    }
    throw new Error(`The transaction ${r.txhash} did not land in a block within a minute.`);
  },
};

async function broadcastNative(acc: UnifiedAccount, mode: "hybrid" | "classical", messages: Parameters<EthNativeSigner["sign"]>[0]["messages"], what: string) {
  const { accountNumber, sequence } = await accountSequence(acc.cosmos);
  const signer = new EthNativeSigner(acc, { signMode: mode, rest: lcd() });
  const res = await signer.signAndBroadcast(restBroadcaster, { chainId: NATIVE_CHAIN_ID, accountNumber, sequence, fee: NATIVE_FEE, messages });
  if (res.code !== 0) throw new Error(`QoreChain refused ${what} (code ${res.code}). ${("rawLog" in res && res.rawLog) || ""}`.trim());
  return res.transactionHash;
}

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
    const data = encodeFunctionData({ abi: lastLightAbi, functionName: functionName as never, args: args as never });
    const hash = await sendTx(me, { to: this.contract, data });
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

  /**
   * Live key setup. QoreX keeps encryption keys to itself and lets no website publish one, so
   * each person gets a Last Light key account: an eth-native account created in this browser
   * from a backup phrase. It registers its own ML-DSA-87 key, publishes its ML-KEM-1024 key with
   * a hybrid signature, and is linked to the person's QoreX address on the contract.
   * QoreX approves two steps: funding the key account, and the link. Each step is skipped when
   * already done, so a failed run can simply be retried.
   */
  async setUpKey(me: Address, keys: KeyStore, step: (t: string) => void) {
    let rec = keys.loadAccount(me);
    if (!rec) rec = keys.saveAccount(me, generateMnemonic(256));
    const acc = await deriveUnifiedAccount(rec.mnemonic, 0);
    if (rec.keyAccount !== acc.cosmos) keys.saveAccount(me, rec.mnemonic, acc.cosmos);
    const kem = kemFromMnemonic(rec.mnemonic);
    let last = "";

    // 1. Fund the key account from QoreX, so it can pay for its own two setup transactions.
    const pqc0 = await fetchPqcStatus({ rest: lcd(), address: acc.cosmos });
    const onChain0 = await readKemKey(acc.cosmos);
    const needsTxs = !pqc0.registered || !onChain0 || !equalBytes(onChain0, kem.publicKey);
    if (needsTxs && (await uqorBalance(acc.cosmos)) < MIN_KEY_ACCOUNT_UQOR) {
      step(`Approve in QoreX: send ${KEY_ACCOUNT_FUNDING} test QOR to your new Last Light key account. It pays that account's two setup fees.`);
      const hash = await sendTx(me, { to: acc.evm as Address, value: parseEther(KEY_ACCOUNT_FUNDING) });
      await waitForTransactionReceipt(config, { hash, chainId: EVM_CHAIN_ID });
      last = hash;
      step("Waiting for the funds to arrive…");
      for (let i = 0; (await uqorBalance(acc.cosmos)) < MIN_KEY_ACCOUNT_UQOR; i++) {
        if (i > 30) throw new Error("The funds have not arrived on the key account yet. Wait a minute and press the button again.");
        await sleep(2000);
      }
    }

    // 2. The key account's own post-quantum signing key (signed classically: the one message that may be).
    if (!pqc0.registered) {
      step("Registering the key account's ML-DSA-87 signing key…");
      const pop = signProofOfPossession({ chainId: NATIVE_CHAIN_ID, account: acc.cosmos, keypair: acc.pqc });
      last = await broadcastNative(acc, "classical", [buildRegisterPqcKeyMsg(acc.cosmos, { pqcKeypair: acc.pqc, proofOfPossession: pop })], "the signing key");
    }

    // 3. Publish the ML-KEM-1024 key, hybrid-signed (secp256k1 + ML-DSA-87).
    if (!onChain0 || !equalBytes(onChain0, kem.publicKey)) {
      step("Publishing your ML-KEM-1024 key, hybrid-signed with ML-DSA-87…");
      last = await broadcastNative(acc, "hybrid", [msg.pqc.registerKemKey({ sender: acc.cosmos, publicKey: kem.publicKey })], "the encryption key");
    }

    // 4. Link it to the person's own address, so owners can find it from their 0x address.
    if ((await this.read<string>("nativeAddressOf", [me])) !== acc.cosmos) {
      step("Approve in QoreX: link this key to your address.");
      last = await this.write("linkNative", [acc.cosmos], me);
    }
    return last || "already set up";
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
