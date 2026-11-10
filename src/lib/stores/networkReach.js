/**
 * Whether the network answers, as the network's pill finds it, for what
 * waits on it to say so where it waits: "offline" where the browser is,
 * "silent" where the node answered nothing for 30 seconds, or a sync got
 * nothing back for as long, and "answering" otherwise.
 */

import { writable } from "svelte/store";

/** @typedef {"answering" | "offline" | "silent"} NetworkReach */

const reach = writable(/** @type {NetworkReach} */ ("answering"));

/**
 * Says how the network answers, as the network's pill finds it.
 *
 * @param {NetworkReach} value
 */
export const setNetworkReach = (value) => reach.set(value);

export default { subscribe: reach.subscribe };
