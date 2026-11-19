/**
 * deploy.ts - deploy LastLight to the QoreChain testnet and point the web app at it.
 *
 *   pnpm build && pnpm deploy:lastlight
 *
 * Needs the deployer from `pnpm new-deployer`, funded, with its ML-DSA-87 key
 * registered (`pnpm window register`) and an open EVM window (`pnpm window open`).
 * Prints the contract address and block, and writes both into web/.env.
 *
 * Before deploying it asks QoreChain's PQC key status precompile (0x...0a02) whether
 * the deployer, and any 0x addresses given as arguments, have a registered ML-DSA key:
 *
 *   pnpm deploy:lastlight 0xYourOwnerWallet 0xYourHeirWallet
 *
 * If every one of them does, the contract is deployed with requirePqcKey = true, so
 * sealing and guardian handoffs revert for accounts without a key. Otherwise it is
 * deployed with requirePqcKey = false: the check still runs and is logged on chain.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createPublicClient, createWalletClient, defineChain, getAddress, http, parseAbi, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const chain = defineChain({
  id: 9800,
  name: "QoreChain Testnet",
  nativeCurrency: { name: "QOR", symbol: "QOR", decimals: 18 },
  rpcUrls: { default: { http: ["https://evm-testnet.qore.host"] } },
});

const key = process.env.PRIVATE_KEY?.trim() as Hex | undefined;
if (!key || /^0x0{64}$/.test(key)) {
  console.error("No deployer key in contracts/.env. Run `pnpm new-deployer` first.");
  process.exit(1);
}

const artifact = JSON.parse(readFileSync(new URL("../artifacts/contracts/LastLight.sol/LastLight.json", import.meta.url), "utf8"));
const account = privateKeyToAccount(key);
const pub = createPublicClient({ chain, transport: http() });
const wallet = createWalletClient({ chain, account, transport: http() });

const balance = await pub.getBalance({ address: account.address });
console.log(`Deployer ${account.address}, balance ${Number(balance) / 1e18} QOR`);
if (balance === 0n) {
  console.error("The deployer has no QOR. Send it some test QOR first.");
  process.exit(1);
}

const PQC_KEY_STATUS = "0x0000000000000000000000000000000000000a02";
const pqcAbi = parseAbi(["function pqcKeyStatus(address account) view returns (bool registered, uint8 algorithmId, bytes pubkey)"]);
const toCheck: Address[] = [account.address, ...process.argv.slice(2).map((a) => getAddress(a))];
let allRegistered = true;
console.log("\nPQC key status precompile:");
for (const a of toCheck) {
  try {
    const [registered, algorithmId] = await pub.readContract({ address: PQC_KEY_STATUS, abi: pqcAbi, functionName: "pqcKeyStatus", args: [a] });
    console.log(`  ${a}: ${registered ? `registered (algorithm ${algorithmId})` : "NOT registered"}`);
    if (!registered) allRegistered = false;
  } catch (e) {
    console.log(`  ${a}: precompile call failed (${(e instanceof Error ? e.message : String(e)).split("\n")[0]})`);
    allRegistered = false;
  }
}
const requirePqcKey = allRegistered;
console.log(
  requirePqcKey
    ? "Every account has a key: deploying with requirePqcKey = true."
    : "Not every account has a key: deploying with requirePqcKey = false (the check is still made and logged).",
);

console.log("\nDeploying LastLight...");
let hash: Hex;
try {
  hash = await wallet.deployContract({ abi: artifact.abi, bytecode: artifact.bytecode as Hex, args: [requirePqcKey] });
} catch (e) {
  const m = e instanceof Error ? e.message : String(e);
  console.error(m.split("\n").slice(0, 3).join("\n"));
  if (/window|pqc|authori/i.test(m)) console.error("\nThe EVM window is probably closed. Run `pnpm window open` and try again.");
  process.exit(1);
}
const receipt = await pub.waitForTransactionReceipt({ hash });
if (receipt.status !== "success" || !receipt.contractAddress) {
  console.error(`The deploy transaction failed: ${hash}`);
  process.exit(1);
}

const address = receipt.contractAddress;
const block = receipt.blockNumber;
console.log(`\nLastLight deployed`);
console.log(`  Address: ${address}`);
console.log(`  Block:   ${block}`);
console.log(`  Tx:      ${hash}`);
console.log(`  requirePqcKey: ${requirePqcKey}`);

writeFileSync(
  new URL("../../web/.env", import.meta.url),
  `VITE_LASTLIGHT_ADDRESS=${address}\nVITE_LASTLIGHT_DEPLOY_BLOCK=${block}\n`,
);
console.log("\nSaved the address in web/.env. Send the lines above back to Claude.");
