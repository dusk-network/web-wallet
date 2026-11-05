import { goto } from "$lib/navigation";
import { walletStore } from "$lib/stores";

import { forgetDrafts, forgetPlace, keepPlace } from "./place";

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
