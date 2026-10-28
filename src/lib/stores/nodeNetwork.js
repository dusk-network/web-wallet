/**
 * The node's network: its file in `@dusk-network/networks`, as the chain ID
 * the node gives names it, or null before that's known or for a chain
 * without a file. The network store sets it; modules that only need the
 * network's contracts and routes read it here, without the node's client.
 */

import { writable } from "svelte/store";

/** @type {import("svelte/store").Writable<import("@dusk-network/networks").Network | null>} */
const nodeNetwork = writable(null);

/**
 * Sets the node's network, as the network store learns it.
 *
 * @param {import("@dusk-network/networks").Network | null} net
 */
export const setNodeNetwork = (net) => nodeNetwork.set(net);

export default { subscribe: nodeNetwork.subscribe };
