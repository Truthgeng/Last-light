/**
 * new-deployer.ts - create a fresh, testnet-only deployer account.
 *
 *   pnpm new-deployer
 *
 * Writes a new mnemonic and its private key into contracts/.env (never
 * committed) and prints the account's addresses so you can fund it from
 * QoreX. Refuses to overwrite a .env that already holds a real key.
 *
 * Use this account only to deploy on testnet. Never put real funds on it.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { deriveUnifiedAccount, generateMnemonic } from "@qorechain/sdk";

const ENV = new URL("../.env", import.meta.url);
const PLACEHOLDER = /^PRIVATE_KEY=0x0{64}\s*$/m;

if (existsSync(ENV)) {
  const current = readFileSync(ENV, "utf8");
  if (/^PRIVATE_KEY=0x[0-9a-fA-F]{64}\s*$/m.test(current) && !PLACEHOLDER.test(current)) {
    console.error("contracts/.env already has a deployer key. Not overwriting it.");
    console.error("Run `pnpm window status` to see its address.");
    process.exit(1);
  }
}

const mnemonic = generateMnemonic(256);
const acc = await deriveUnifiedAccount(mnemonic, 0);

writeFileSync(
  ENV,
  [
    "# Testnet-only deployer created by `pnpm new-deployer`. Never commit this file.",
    `QORE_MNEMONIC=${mnemonic}`,
    `PRIVATE_KEY=${acc.privateKey}`,
    "QORE_NETWORK=testnet",
    "QORE_WINDOW_BLOCKS=600",
    "QORE_WINDOW_TXS=5",
    "",
  ].join("\n"),
  { mode: 0o600 },
);

console.log("Created a testnet-only deployer and saved it in contracts/.env\n");
console.log(`  Native address: ${acc.cosmos}`);
console.log(`  EVM address:    ${acc.evm}\n`);
console.log("Next: send about 2 test QOR to the native address (qor1...) from QoreX,");
console.log("then run: pnpm window register");
