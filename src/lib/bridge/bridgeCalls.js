/**
 * The DuskEVM bridge's contracts on Dusk, as set or from the network's file,
 * and whom a withdrawal pays on Dusk.
 */

import { get } from "svelte/store";

import nodeNetwork from "$lib/stores/nodeNetwork";
import { duskEvmContractId } from "$lib/web3/duskEvm";

/** @param {unknown} id */
const norm = (id) =>
  String(id ?? "")
    .trim()
    .toLowerCase()
    .replace(/^0x/, "");

/**
 * Whom a withdrawal pays on Dusk, as the wallet keeps it: a Dusk account, or
 * a Dusk contract's ID; null for none.
 *
 * @param {import("@dusk-network/networks/duskevm").DuskRecipient | null | undefined} recipient
 */
export const recipientOf = (recipient) =>
  recipient
    ? recipient.kind === "account"
      ? recipient.account
      : recipient.contractId
    : null;

/**
 * The bridge's contracts on Dusk, from the network's file or as set: the
 * deposit bridge and the withdrawal portal, as the history keeps contract
 * IDs.
 */
export const configuredBridge = () => ({
  bridge: norm(
    duskEvmContractId(
      "l1_standard_bridge",
      import.meta.env.VITE_BRIDGE_CONTRACT_ID
    )
  ),
  portal: norm(
    duskEvmContractId(
      "optimism_portal",
      import.meta.env.VITE_EVM_OPTIMISM_PORTAL_CONTRACT_ID
    )
  ),
});

/** @type {WeakMap<import("@dusk-network/networks").Network, import("@dusk-network/networks").Network>} */
const withSetBridge = new WeakMap();

/**
 * The node's network, with the bridge and Portal set for a local
 * deployment in place of its file's, so the history reads the calls the
 * wallet sends. A network whose file has no DuskEVM gets them too, the one
 * set standing for both when only one is. Kept per network, as the
 * settings don't change while the wallet runs.
 */
export function bridgeNetwork() {
  const net = get(nodeNetwork);

  if (!net) {
    return net;
  }

  const contracts = net.duskEvm?.contracts ?? {};
  const { bridge, portal } = configuredBridge();
  /** @param {"l1_standard_bridge" | "optimism_portal"} name @param {string} id */
  const differs = (name, id) =>
    Boolean(id) && norm(contracts[name]?.contractId) !== id;

  if (
    !differs("l1_standard_bridge", bridge) &&
    !differs("optimism_portal", portal)
  ) {
    return net;
  }

  let set = withSetBridge.get(net);

  if (!set) {
    /** @param {"l1_standard_bridge" | "optimism_portal"} name @param {string} id @param {string} other */
    const as = (name, id, other) =>
      id
        ? { ...contracts[name], contractId: id }
        : (contracts[name] ?? { contractId: other });

    set = /** @type {import("@dusk-network/networks").Network} */ ({
      ...net,
      duskEvm: {
        predeploys: {},
        ...net.duskEvm,
        contracts: {
          ...contracts,
          ["l1_standard_bridge"]: as("l1_standard_bridge", bridge, portal),
          ["optimism_portal"]: as("optimism_portal", portal, bridge),
        },
      },
    });
    withSetBridge.set(net, set);
  }

  return set;
}
