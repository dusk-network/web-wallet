import { get } from "svelte/store";

import { goto } from "$lib/navigation";
import { walletStore } from "$lib/stores";

import { sendUnsentAgain } from "./unsentSends";

/**
 * Takes a send that never went out to Send's review, filled in with it, on
 * the profile it was sent from: it's sent from there, and said where it's
 * kept until it is. Nothing where the wallet open hasn't that profile.
 *
 * @param {import("./unsentSends").UnsentSend} send
 * @returns {Promise<void>}
 */
export default async function reviewUnsent(send) {
  const { currentProfile, profiles } = get(walletStore);
  const profile = profiles.find(
    (each) => String(each.account) === send.account,
  );

  if (!profile) {
    return;
  }

  // The profile it's sent from first: Send takes it for that one alone.
  if (profile !== currentProfile) {
    walletStore.setCurrentProfile(profile).catch(() => {});
  }

  sendUnsentAgain(send);
  await goto("/dashboard/send");
}
