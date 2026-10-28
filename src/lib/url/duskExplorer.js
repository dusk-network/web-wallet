import { get } from "svelte/store";

import nodeNetwork from "$lib/stores/nodeNetwork";

/**
 * A page of the Dusk explorer of the node's network, as its file in
 * `@dusk-network/networks` gives the explorer: "/transactions/transaction?id=…"
 * on "https://apps.testnet.dusk.network/explorer". Without a file, the
 * explorer beside the wallet.
 *
 * @param {string} path
 */
export const duskExplorerUrl = (path) =>
  `${(get(nodeNetwork)?.apps.explorer ?? "/explorer").replace(/\/+$/, "")}${path}`;

/**
 * A Dusk transaction in the explorer, by its ID, with or without 0x.
 *
 * @param {string} hash
 */
export const duskExplorerTx = (hash) =>
  duskExplorerUrl(`/transactions/transaction?id=${hash.replace(/^0x/i, "")}`);

/**
 * A Dusk block in the explorer, by its hash.
 *
 * @param {string} hash
 */
export const duskExplorerBlock = (hash) =>
  duskExplorerUrl(`/blocks/block?id=${hash}`);
