import { goto } from "$lib/navigation";
import { walletStore } from "$lib/stores";

import { forgetDrafts, forgetPlace, keepPlace } from "./place";

let isLockedHere = false;

/**
 * Whether this page locked since it loaded: the unlock that follows leaves the
 * fingerprint to be asked for, as opposed to a tab opened or reloaded.
 */
export const lockedHere = () => isLockedHere;

/**
 * Logs out the user.
 * If `isForced` is set to `true`, a querystring
 * parameter is added to instruct the home page
 * to add an explanation about the forced logout.
 * The next unlock returns to the page it left, but after a forced one: another
 * tab set up another wallet in place of this one.
 *
 * @param {boolean} isForced
 * @returns {ReturnType<goto>}
 */
const logout = async (isForced) => {
  isLockedHere = true;

  if (isForced) {
    forgetPlace();
    forgetDrafts();
  } else {
    keepPlace(window.location);
  }

  walletStore.reset();
  return goto(`/${isForced ? "forced-logout" : ""}`);
};

export default logout;
