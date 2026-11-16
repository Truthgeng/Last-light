# How AI was used

Last Light was built by Truth (GitHub: Truthgeng) with Claude, Anthropic's AI assistant, as a coding partner.

## What Truth did

- Chose the problem, the name and the product direction: a crypto inheritance vault with three guardians, any two of whom release it to the heir.
- Decided how the app should behave for owners, heirs and guardians, including the wallet approvals shown in the demo.
- Created the testnet deployer account, deployed the contract to the QoreChain testnet from his own machine, and tested the full flow end to end with real QoreX wallets.
- Recorded the demo footage and supplied the voiceover.

## What Claude did

- Wrote most of the code in `packages/crypto`, `contracts` and `web`, along with the tests.
- Worked through QoreChain and QoreX behaviour found during testing (key registration limits, account types, RPC log range limits) and changed the design to fit, for example the key account approach.
- Wrote the README, edited the demo video and made the cover image.

## How the work was checked

- 24 tests for the encryption core and 8 for the contract, including a full seal, release and recover run.
- Every step was run live on the QoreChain testnet with real wallet approvals before submission.
- The encryption uses audited libraries (`@noble/post-quantum`, `@noble/ciphers`, `@noble/hashes`) and does not implement its own primitives.
