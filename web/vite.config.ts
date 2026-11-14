import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      { find: "@last-light/crypto", replacement: fileURLToPath(new URL("../packages/crypto/src/index.ts", import.meta.url)) },
      // The crypto core lives outside this folder. Point its exact imports at this
      // folder's copies, without touching the older @noble versions viem uses.
      ...["@noble/post-quantum/ml-kem.js", "@noble/ciphers/aes.js", "@noble/hashes/hkdf.js", "@noble/hashes/sha2.js"].map((id) => ({
        find: new RegExp(`^${id.replace(/[/.]/g, "\\$&")}$`),
        replacement: fileURLToPath(new URL(`./node_modules/${id}`, import.meta.url)),
      })),
    ],
  },
  server: {
    port: 5180,
    fs: { allow: [".."] },
    // The public REST endpoint sends no CORS headers, so the browser reaches it through /lcd.
    proxy: { "/lcd": { target: "https://api-testnet.qore.host", changeOrigin: true, rewrite: (p) => p.replace(/^\/lcd/, "") } },
  },
});
