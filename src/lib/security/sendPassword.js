/**
 * The password again, on any send above an amount chosen in Settings, checked
 * against the vault. It's off until it's turned on, and a wallet without a
 * password has no vault to check against, so it never asks there: Settings
 * offers it only with a password. Changing it takes the password too, or an
 * unlocked tab could simply turn it off.
 *
 * The amount is kept on its own, not with the settings: each tab has its own
 * copy of those, and writes all of it back, so another tab open since could
 * turn this off by changing its dark mode. It's read as each send begins.
 */

import { get, writable } from "svelte/store";

import SendPasswordDeclinedError from "$lib/errors/send-password-declined-error";
import vault from "$lib/vault";

const KEY = `${CONFIG.LOCAL_STORAGE_APP_KEY}-send-password`;

/**
 * The amount above which a send asks for the password, in Lux: null while it's
 * off. What can't be read asks on every send, rather than turn it off.
 *
 * @returns {bigint | null}
 */
export function sendPasswordLimit() {
  const kept = localStorage.getItem(KEY);

  return kept === null ? null : /^\d+$/.test(kept) ? BigInt(kept) : 0n;
}

/**
 * Sets that amount, once the password was checked (`vault.check`): null turns
 * it off.
 *
 * @param {bigint | null} lux
 */
export function setSendPasswordLimit(lux) {
  if (lux === null) {
    localStorage.removeItem(KEY);
  } else {
    localStorage.setItem(KEY, String(lux));
  }
}

/**
 * What's asking for the password now: what the dialog answers.
 *
 * @typedef {{
 *   answer: (password: string) => Promise<void>,
 *   cancel: (reason?: Error) => void,
 *   limit: bigint,
 * }} SendPasswordAsk
 */

/** @type {import("svelte/store").Writable<SendPasswordAsk | null>} */
const asking = writable(null);

/** What's asking for the password now, for the dialog to show. */
export const sendPasswordAsk = { subscribe: asking.subscribe };

/**
 * Nothing goes on asking: a lock, a switch or leaving the wallet ends it, as a
 * cancelled ask, with what stopped it.
 *
 * @param {Error} [reason]
 */
export const cancelSendPassword = (reason) => get(asking)?.cancel(reason);

/**
 * What a send waits for before anything of it is made, for `lux` it takes from
 * the wallet at most: none (`null`) at or below the amount, and while it's off
 * or there's no password, or else the password, which rejects with
 * SendPasswordDeclinedError when it isn't given.
 *
 * @param {bigint} lux
 * @param {string} wallet The vault ID of the wallet open: the password must
 *   open it
 * @returns {Promise<void> | null}
 */
export function sendPasswordFor(lux, wallet) {
  const limit = sendPasswordLimit();

  if (limit === null || lux <= limit || !vault.exists()) {
    return null;
  }

  cancelSendPassword();

  return new Promise((resolve, reject) => {
    /** Only this ask, while it's the one asking: another may have taken over. */
    const stopAsking = () => {
      if (get(asking) === ask) {
        asking.set(null);
      }
    };

    /** @type {SendPasswordAsk} */
    const ask = {
      async answer(password) {
        await vault.check(password, wallet);

        // Cancelled during the check, it has been rejected already.
        stopAsking();
        resolve();
      },
      cancel(reason = new SendPasswordDeclinedError()) {
        stopAsking();
        reject(reason);
      },
      limit,
    };

    asking.set(ask);
  });
}
