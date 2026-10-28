/**
 * DuskEVM as the EVM wallets and viem see it, from the configuration: no
 * code runs to make it, so any page can use it.
 */

const VITE_EVM_BRIDGE_CONTRACT_ADDRESS = import.meta.env
  .VITE_EVM_BRIDGE_CONTRACT_ADDRESS;
const VITE_EVM_BRIDGE_CONTRACT_BLOCK_CREATED = import.meta.env
  .VITE_EVM_BRIDGE_CONTRACT_BLOCK_CREATED;
const VITE_EVM_BRIDGE_BLOCK_EXPLORER_NAME = import.meta.env
  .VITE_EVM_BRIDGE_BLOCK_EXPLORER_NAME;
const VITE_EVM_BRIDGE_BLOCK_EXPLORER_URL = import.meta.env
  .VITE_EVM_BRIDGE_BLOCK_EXPLORER_URL;
const VITE_EVM_BRIDGE_RPC_URL = import.meta.env.VITE_EVM_BRIDGE_RPC_URL;
const VITE_EVM_CHAIN_ID = Number(import.meta.env.VITE_EVM_CHAIN_ID);

export const duskEvm = {
  blockExplorers: {
    default: {
      name: VITE_EVM_BRIDGE_BLOCK_EXPLORER_NAME,
      url: VITE_EVM_BRIDGE_BLOCK_EXPLORER_URL,
    },
  },
  contracts: {
    L2StandardBridge: {
      address: VITE_EVM_BRIDGE_CONTRACT_ADDRESS,
      blockCreated: VITE_EVM_BRIDGE_CONTRACT_BLOCK_CREATED,
    },
  },
  id: VITE_EVM_CHAIN_ID,
  name: "DuskEVM",
  nativeCurrency: {
    decimals: 18,
    name: "Dusk",
    symbol: "DUSK",
  },
  rpcUrls: {
    default: {
      http: [VITE_EVM_BRIDGE_RPC_URL],
    },
    public: {
      http: [VITE_EVM_BRIDGE_RPC_URL],
    },
  },
};
