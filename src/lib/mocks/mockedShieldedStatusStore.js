import { mockReadableStore } from "$lib/dusk/test-helpers";

/** @type {ShieldedStatusStoreContent} */
const content = { isKnown: true, isPaused: false };

const mockedShieldedStatusStore = {
  ...mockReadableStore(content),
  refresh: () => Promise.resolve(),
};

export default mockedShieldedStatusStore;
