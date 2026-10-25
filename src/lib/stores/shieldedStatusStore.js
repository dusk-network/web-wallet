import { writable } from "svelte/store";

import { isFeatureActiveAt } from "$lib/network";

import networkStore from "./networkStore";

/** @type {ShieldedStatusStoreContent} */
const initialState = { isKnown: false, isPaused: false };

const { set, subscribe } = writable(initialState);

/** The number of the last refresh started. */
let lastRequest = 0;

/** The number of the refresh whose answer the store holds. */
let lastApplied = 0;

/**
 * Asks the node if shielded transactions are paused for the next block.
 * If it can't tell, the store keeps what it knew. Until the node first
 * answers, `isKnown` is false and shielded transactions aren't paused.
 * Refreshes can overlap: an answer only replaces one from a refresh
 * started before it.
 *
 * @type {ShieldedStatusStoreServices["refresh"]}
 */
const refresh = () => {
  const request = ++lastRequest;

  return Promise.all([
    networkStore.getNodeFeatures(),
    networkStore.getCurrentBlockHeight(),
  ])
    .then(([features, height]) => {
      if (request > lastApplied) {
        lastApplied = request;
        set({
          isKnown: true,
          isPaused: isFeatureActiveAt(features, "DISABLE_PHOENIX", height + 1n),
        });
      }
    })
    .catch(() => {});
};

/** @type {ShieldedStatusStore} */
export default {
  refresh,
  subscribe,
};
