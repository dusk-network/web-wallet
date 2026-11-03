import { ProfileGenerator } from "@dusk/w3sper";
import { writable } from "svelte/store";

import { stakeInfo } from "$lib/mock-data";

import { mockReadableStore } from "$lib/dusk/test-helpers";

const seed = new Uint8Array(64);
const seeder = async () => seed;
const profileGenerator = new ProfileGenerator(seeder);
const profiles = [
  await profileGenerator.default,
  await profileGenerator.next(),
  await profileGenerator.next(),
];

const currentProfile = profiles[0];
const shielded = { spendable: 50_000_000_000_000n, value: 2_345_000_000_000n };
const unshielded = { nonce: 1234n, value: shielded.value / 2n };

/** @type {WalletStoreContent & { currentProfile: NonNullable<WalletStoreContent["currentProfile"]> }} */
const content = {
  balance: { shielded, unshielded },
  currentProfile,
  initialized: true,
  minimumStake: 1_000_000_000_000n,
  pendingStakes: [],
  profiles,
  stakeInfo,
  syncStatus: {
    error: null,
    from: 0n,
    isInProgress: false,
    last: 0n,
    progress: 0,
  },
  walletKey: "",
  wallets: [{ key: "", n: 1 }],
};

const mockedWalletStore = {
  ...mockReadableStore(content),

  /** The block a resync syncs from, while it runs: null for none. */
  resyncing: writable(/** @type {bigint | null} */ (null)),
};

export default mockedWalletStore;
