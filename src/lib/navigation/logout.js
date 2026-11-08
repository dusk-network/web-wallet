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
 * tab set up another wallet in place of this one. A lock after time away
 * (`lockedAfterMs`) goes straight to the unlock, which says why.
 *
 * @param {boolean} isForced
 * @param {number} [lockedAfterMs] How long it was left alone, for a lock of its own
 * @returns {ReturnType<goto>}
 */
const logout = async (isForced, lockedAfterMs) => {
  isLockedHere = true;

  if (isForced) {
    forgetPlace();
    forgetDrafts();
  } else {
    keepPlace(window.location);
  }

  walletStore.reset();

  return isForced
    ? goto("/forced-logout")
    : lockedAfterMs
      ? goto("/unlock", {
          state: { lockedAfter: Math.round(lockedAfterMs / 60_000) },
        })
      : goto("/");
};

export default logout;
