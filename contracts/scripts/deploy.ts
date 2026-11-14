/**
 * deploy.ts - deploy LastLight to the QoreChain testnet and point the web app at it.
 *
 *   pnpm build && pnpm deploy:lastlight
 *
 * Needs the deployer from `pnpm new-deployer`, funded, with its ML-DSA-87 key
 * registered (`pnpm window register`) and an open EVM window (`pnpm window open`).
 * Prints the contract address and block, and writes both into web/.env.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createPublicClient, createWalletClient, defineChain, http, type Hex } from "viem";
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

console.log("Deploying LastLight...");
let hash: Hex;
try {
  hash = await wallet.deployContract({ abi: artifact.abi, bytecode: artifact.bytecode as Hex });
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
console.log(`  Tx:      https://explore.qore.network/tx/${hash}`);

writeFileSync(
  new URL("../../web/.env", import.meta.url),
  `VITE_LASTLIGHT_ADDRESS=${address}\nVITE_LASTLIGHT_DEPLOY_BLOCK=${block}\n`,
);
console.log("\nSaved the address in web/.env. Send these three lines back to Claude.");
