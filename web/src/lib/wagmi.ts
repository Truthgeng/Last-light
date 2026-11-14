import { connectorsForWallets } from "@rainbow-me/rainbowkit";
import { injectedWallet } from "@rainbow-me/rainbowkit/wallets";
import { defineChain } from "viem";
import { qorexWallet } from "@qorechain/qorex-rainbowkit";
import { createConfig, http } from "wagmi";

// QoreChain testnet EVM lane (same values as @qorechain/evm's qorechainTestnet).
export const qorechainTestnet = defineChain({
  id: 9800,
  name: "QoreChain Testnet",
  nativeCurrency: { name: "QOR", symbol: "QOR", decimals: 18 },
  rpcUrls: { default: { http: ["https://evm-testnet.qore.host"] } },
  blockExplorers: { default: { name: "QoreChain Explorer", url: "https://explore.qore.network" } },
  testnet: true,
});

// QoreX first. Neither wallet uses WalletConnect, so the project id is a placeholder.
const connectors = connectorsForWallets(
  [{ groupName: "Recommended", wallets: [() => qorexWallet({ pollAccountsOnFocus: true }), injectedWallet] }],
  { appName: "Last Light", projectId: import.meta.env.VITE_WALLETCONNECT_PROJECT_ID ?? "unused" },
);

export const config = createConfig({
  chains: [qorechainTestnet],
  connectors,
  transports: { [qorechainTestnet.id]: http() },
});

declare module "wagmi" {
  interface Register {
    config: typeof config;
  }
}
