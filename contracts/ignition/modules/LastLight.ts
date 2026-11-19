import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

/**
 * Deploys LastLight. On QoreChain the deployer needs a registered ML-DSA-87 key
 * and a live EVM authorisation window first (pnpm window register, pnpm window open).
 */
export default buildModule("LastLightModule", (m) => {
  const lastLight = m.contract("LastLight", [m.getParameter("requirePqcKey", true)]);
  return { lastLight };
});
