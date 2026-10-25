import { writable } from "svelte/store";

import { isFeatureActiveAt } from "$lib/network";

import networkStore from "./networkStore";

/** @type {ShieldedStatusStoreContent} */
const initialState = { isKnown: false, isPaused: false };

const { set, subscribe } = writable(initialState);

/**
 * Asks the node if shielded transactions are paused for the next block.
 * If it can't tell, the store keeps what it knew. Until the node first
 * answers, `isKnown` is false and shielded transactions aren't paused.
 *
 * @type {ShieldedStatusStoreServices["refresh"]}
 */
const refresh = () =>
  Promise.all([
    networkStore.getNodeFeatures(),
    networkStore.getCurrentBlockHeight(),
  ])
    .then(([features, height]) => {
      set({
        isKnown: true,
        isPaused: isFeatureActiveAt(features, "DISABLE_PHOENIX", height + 1n),
      });
    })
    .catch(() => {});

/** @type {ShieldedStatusStore} */
export default {
  refresh,
  subscribe,
};
