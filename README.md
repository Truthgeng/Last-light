# Last Light

Post-quantum crypto inheritance on QoreChain.

When someone dies holding crypto and nobody has the keys, the money is gone for good. Last Light lets you leave your seed phrase (or any wallet instructions) to someone you trust, so they can open it only after you stop checking in. Nobody can open it before that. Not the person you leave it to, not the people who help release it, and not anyone reading the chain.

A secret like this has to stay safe for years, maybe decades. Data encrypted today with classical cryptography can be stored now and broken later by a quantum computer ("harvest now, decrypt later"). Last Light encrypts everything with ML-KEM-1024 (NIST FIPS 203), to keys each person publishes on QoreChain.

Built for the QoreChain **Build Before Q-Day** Developer Fest, Encrypted Apps category.

## How it works

There are three roles:

- **Owner:** the person protecting their crypto.
- **Heir:** the person who receives it.
- **Guardians:** three trusted people who help release it. Any two of them must agree before anything opens.

1. **Everyone publishes a key.** The heir and each guardian create an ML-KEM-1024 key pair in their browser and publish the public key on QoreChain (`msg.pqc.registerKemKey`, a hybrid-signed transaction from an account with a registered ML-DSA-87 key). The secret key never leaves their device.
2. **The owner seals a vault.** In the owner's browser, the secret is encrypted with a random vault key. That key is split into two halves:
   - **Half A** is sealed to the heir's key.
   - **Half B** is split again into one share per guardian, so that any two of the three guardians must act together. Each share is sealed to that guardian's key.
   Only the encrypted pieces go on chain.
3. **The owner checks in.** One transaction per period, for example every 90 days.
4. **Release.** If the owner misses a check-in, the contract marks the vault as released. Each guardian opens their share and seals it to the heir. The contract accepts these handoffs only after release.
5. **The heir recovers the secret.** Once two guardians have handed off, the heir rebuilds Half B, joins it with Half A into the vault key and decrypts the secret in their browser.

Before release, the heir holds only Half A and each guardian holds only one share of Half B. The heir plus one guardian cannot open the vault. The guardians together cannot open it either, because they never see Half A.

## Repository

| Folder | What |
|---|---|
| `packages/crypto` | Encryption core: ML-KEM-1024 envelopes, key split, guardian shares, seal, handoff and recover. Runs entirely on the user's device. |
| `contracts` | The LastLight vault contract: check-ins, release, guardian handoffs. Hardhat, deployed on the QoreChain EVM. |
| `web` | The app for owners, heirs and guardians. Vite, React, wagmi and the QoreX wallet. Has a demo mode that runs the whole flow in the browser with sample people. |

## Encryption details

- **Envelope:** ML-KEM-1024 encapsulation to the recipient's on-chain key, HKDF-SHA256, then AES-256-GCM.
- **Context binding:** every envelope is bound to the chain, the contract, the vault, the role and the recipient address. An envelope taken from one vault cannot be used in another.
- **Guardian shares:** Shamir secret sharing over GF(2^8), two of three by default. One unreachable guardian does not lock the heir out.
- **Length hiding:** secrets are padded to 1024 bytes, so the ciphertext does not reveal whether it holds a 12-word or a 24-word phrase.
- **Libraries:** audited `@noble/post-quantum`, `@noble/ciphers` and `@noble/hashes`.

## The contract

**Live on the QoreChain testnet:** [`0x9539b30246c300d3002b828beab9647a04789233`](https://explore.qore.network/address/0x9539b30246c300d3002b828beab9647a04789233) (EVM chain 9800, deployed in block 10105930, [deploy tx](https://explore.qore.network/tx/0xec0ed2b9821104a00e5ae266e767d93b612cdc3a1775f5aee5a88ac02ee4d34c)).


`LastLight.sol` never sees anything readable. It records who the owner, heir and guardians are, tracks check-ins, decides when a vault is released, and accepts guardian handoffs only after release. The encrypted pieces (about 8 KB per vault) are published in events instead of storage, which keeps sealing cheap. The contract stores a hash of them, so the app can confirm that what it reads from the logs is exactly what was sealed.

Each vault id is known before sealing (`nextVaultId`), because every encrypted piece is bound to its vault.

## Run the tests

```sh
cd packages/crypto && npm install && npm test     # encryption core
cd contracts && pnpm install && pnpm test         # contract, including a full seal, release and recover run
```

## The web app

```sh
cd web
pnpm install
cp .env.example .env          # set VITE_LASTLIGHT_ADDRESS after deploying the contract
pnpm dev                      # http://localhost:5180
```

- **Demo mode** (`?demo`, or when no contract address is set): five sample people (owner, heir, three guardians), a simulated chain and a "skip time" button. The encryption is the real ML-KEM-1024 code.
- **Testnet mode:** connect the QoreX wallet. Publishing your ML-KEM-1024 key is a native `MsgRegisterKEMKey`, hybrid-signed by QoreX (secp256k1 + ML-DSA-87). Vault actions are calls to the LastLight contract on the EVM lane.
- Your ML-KEM secret key stays in this browser. The app asks you to download a backup, and can restore it on another device.
- The browser reads the chain's REST API through `/lcd` (a Vite proxy in development, a rewrite in `vercel.json` when hosted), because the public endpoint sends no CORS headers.

## Deploy to the QoreChain testnet

```sh
cd contracts
cp .env.example .env          # add a testnet-only key, never commit it
pnpm window register          # once: register the account's ML-DSA-87 key
pnpm window open              # hybrid-signed: open an EVM window
pnpm deploy:testnet
```

## Known limits

- **Collusion.** If the heir and two guardians combine their pieces early, they can open the vault. One guardian working with the heir is not enough. Choose guardians who do not all answer to the heir.
- **Unreachable guardians.** If two of the three guardians are unreachable at release, the heir has to wait for one of them.
- **Lost keys.** If the heir loses their ML-KEM secret key, they cannot open the vault. The app asks every user to back up their key.

## License

Apache-2.0
