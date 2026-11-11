/**
 * Keeping one's place, in this tab alone, as sessionStorage keeps it: where
 * the wallet was, for the unlock after a lock or a reload to return to, with
 * the profile it was on; and what was typed in a form that moves money, until
 * the transaction goes out. Nothing here is a secret: a draft holds the fields
 * its form gives it, and no form with a recovery phrase, a password or a key
 * has one.
 */

import { base } from "$app/paths";
import { onDestroy } from "svelte";
import { get } from "svelte/store";

import { networkStore, walletStore } from "$lib/stores";
import validateMnemonic from "$lib/wallet/validateMnemonic";

const PLACE = `${CONFIG.LOCAL_STORAGE_APP_KEY}-place`;
const PROFILE = `${CONFIG.LOCAL_STORAGE_APP_KEY}-place-profile`;
const DRAFT = `${CONFIG.LOCAL_STORAGE_APP_KEY}-draft-`;

/** The pages a wallet has to be open for: the ones a place can be. */
const APP_PAGE = /^\/(dashboard|settings|wallets)(\/|$|\?)/;

/** A place can't be kept where this tab's storage can't be used: it's lost. */
const kept = {
  /** @param {string} key */
  read(key) {
    try {
      return sessionStorage.getItem(key);
    } catch {
      return null;
    }
  },

  /** @param {string} key */
  remove(key) {
    try {
      sessionStorage.removeItem(key);
    } catch {
      // Nothing was kept.
    }
  },

  /**
   * @param {string} key
   * @param {string} value
   */
  write(key, value) {
    try {
      sessionStorage.setItem(key, value);
    } catch {
      // It's lost with a reload, as it was before.
    }
  },
};

/**
 * Keeps a page of the wallet, its query too, for the next unlock to return
 * to: a page that shows without a wallet is no place to return to, and leaves
 * the one kept as it is.
 *
 * @param {Pick<URL, "pathname" | "search">} where
 */
export function keepPlace({ pathname, search }) {
  const path =
    base && pathname.startsWith(base) ? pathname.slice(base.length) : pathname;

  if (APP_PAGE.test(path)) {
    kept.write(PLACE, `${path}${search}`);
  }
}

/**
 * The page kept, once: where an unlock goes, without the base path.
 *
 * @returns {string | null}
 */
export function takePlace() {
  const href = kept.read(PLACE);

  kept.remove(PLACE);

  return href && APP_PAGE.test(href) ? href : null;
}

/**
 * The page kept, left for the unlock or the setup that takes it: what a link
 * asked for, to show before a wallet opens.
 *
 * @returns {string | null}
 */
export function peekPlace() {
  const href = kept.read(PLACE);

  return href && APP_PAGE.test(href) ? href : null;
}

/** No page to return to, as after a lock on purpose. */
export const forgetPlace = () => kept.remove(PLACE);

/**
 * Keeps which profile the wallet open is on: a reload gives no time to.
 *
 * @param {string} wallet Its vault ID: "" for one without a password
 * @param {number} profile
 */
export const keepProfile = (wallet, profile) =>
  kept.write(PROFILE, JSON.stringify({ profile, wallet }));

/**
 * The profile to open a wallet on, as it last was in this tab.
 *
 * @param {string} wallet Its vault ID: "" for one without a password
 * @returns {number | undefined} None for another wallet, or none kept
 */
export function keptProfile(wallet) {
  try {
    const place = JSON.parse(kept.read(PROFILE) ?? "null");

    return place?.wallet === wallet && Number.isInteger(place.profile)
      ? place.profile
      : undefined;
  } catch {
    return undefined;
  }
}

/** Who a draft is for: its network, its wallet and its profile's account. */
function draftOwner() {
  const { currentProfile, initialized, walletKey } = get(walletStore);

  return initialized
    ? JSON.stringify([
        String(get(networkStore).networkName),
        walletKey,
        String(currentProfile?.account),
      ])
    : null;
}

/**
 * Whether two owners are one wallet on one network, whichever its profile.
 *
 * @param {string} a
 * @param {string} b
 */
function sameWallet(a, b) {
  const [networkA, walletA] = JSON.parse(a);
  const [networkB, walletB] = JSON.parse(b);

  return networkA === networkB && walletA === walletB;
}

/**
 * Whether a draft's values hold nothing of what was typed.
 *
 * @param {Record<string, unknown>} values
 */
const isEmpty = (values) =>
  Object.values(values).every(
    (value) =>
      !value || (typeof value === "object" && !Object.keys(value).length)
  );

/**
 * A draft's values, without any that reads as a recovery phrase, as one pasted
 * into a memo by mistake.
 *
 * @param {Record<string, unknown>} values
 */
const withoutPhrases = (values) =>
  Object.fromEntries(
    Object.entries(values).map(([name, value]) => [
      name,
      typeof value === "string" && validateMnemonic(value.trim()) ? "" : value,
    ])
  );

/**
 * The form that keeps each draft, by its name: the one made last, as a page
 * draws a form in place of another, as for another link. The one it replaced
 * keeps nothing from then on, as it goes after; one left with none in its
 * place still does, as for a send that fails once its page was left.
 *
 * @type {Map<string, object>}
 */
const keepers = new Map();

/**
 * What a form that moves money keeps of what's typed in it, for a lock, a
 * reload, leaving it or a send that failed with nothing sent to bring back,
 * for the same wallet, profile and network. For a component to take as it's
 * made: leaving the form in the wallet keeps it for its next opening, by Back
 * or by a link, as Home's. It goes (`clear`) once the transaction goes out, so
 * that nothing a reload brings back was sent already: the form shows it to be
 * reviewed, never sent, in any case.
 *
 * @param {string} name
 */
export function formDraft(name) {
  const key = `${DRAFT}${name}`;
  const self = {};
  let isKept = false;

  keepers.set(key, self);

  /** Whether this form keeps the draft still: no other took its place. */
  const isKeeper = () => (keepers.get(key) ?? self) === self;

  /** @type {string | null} */
  let owner = null;

  /**
   * What's kept now.
   *
   * @type {Record<string, unknown> | null}
   */
  let held = null;

  const clear = () => {
    held = null;

    if (isKeeper()) {
      kept.remove(key);
    }
  };

  /** @param {Record<string, unknown>} values */
  const write = (values) => {
    if (isEmpty(values)) {
      clear();
    } else if (owner && isKeeper()) {
      held = values;
      kept.write(
        key,
        JSON.stringify({ owner, values: withoutPhrases(values) })
      );
    }
  };

  // A form stays open through a switch of profile, with what's typed in it: a
  // lock or a reload comes back on that profile, so that's who it's kept for.
  // Another wallet or network draws the page anew, and what was typed for this
  // one goes: it's never staged on another.
  const stopFollowing = walletStore.subscribe(() => {
    const now = draftOwner();

    if (!held || !now || now === owner) {
      return;
    }

    if (owner && sameWallet(now, owner)) {
      owner = now;
      write(held);
    } else {
      clear();
    }
  });

  onDestroy(() => {
    stopFollowing();

    // One that took its place keeps the draft, from what it shows.
    if (!isKeeper()) {
      return;
    }

    keepers.delete(key);

    if (!isKept && get(walletStore).initialized) {
      if (held) {
        // Left, by Back as a phone's is pressed by the way, or by a link as
        // Home's: kept for the form's next opening, as a lock keeps it.
        kept.write(
          key,
          JSON.stringify({ owner, values: withoutPhrases(held) })
        );
      } else {
        kept.remove(key);
      }
    }
  });

  return {
    clear,

    /**
     * What was typed, for the wallet open now: null for none. Another's goes.
     * With no wallet open, as a lock draws the page once more on its way to
     * the unlock, it's left for the unlock to bring back.
     *
     * @returns {any}
     */
    read() {
      owner = draftOwner();

      if (!owner) {
        return null;
      }

      try {
        const draft = JSON.parse(kept.read(key) ?? "null");

        if (draft && draft.owner === owner) {
          return draft.values;
        }
      } catch {
        // No draft.
      }

      clear();

      return null;
    },

    /**
     * Keeps what's typed as it's typed. A wallet that locked keeps what it
     * had: what a lock leaves showing isn't typed. Nor is what a form drawn
     * for another wallet still shows.
     *
     * @param {Record<string, unknown>} values
     */
    save(values) {
      const now = draftOwner();

      if (now && (!owner || sameWallet(now, owner))) {
        owner = now;
        isKept = false;
        write(values);
      }
    },

    /**
     * Keeps it through a send that failed with nothing sent: for the form to
     * bring back, also after leaving it.
     *
     * @param {Record<string, unknown>} values
     */
    keep(values) {
      isKept = true;
      write(values);
    },
  };
}

/**
 * Every form's draft goes, with the profile kept, as with another wallet in
 * place of this one.
 */
export function forgetDrafts() {
  kept.remove(PROFILE);

  try {
    for (const key of Object.keys(sessionStorage)) {
      if (key.startsWith(DRAFT)) {
        sessionStorage.removeItem(key);
      }
    }
  } catch {
    // Nothing was kept.
  }
}

/**
 * The gas a form keeps in a draft: only if edited.
 *
 * @param {ContractGasSettings} gas
 * @param {ContractGasSettings} defaults
 * @returns {{ limit: string, price: string } | undefined}
 */
export const gasToKeep = ({ gasLimit, gasPrice }, defaults) =>
  gasLimit === defaults.gasLimit && gasPrice === defaults.gasPrice
    ? undefined
    : { limit: String(gasLimit), price: String(gasPrice) };

/**
 * The gas a form starts from: as kept in a draft, or else `fallback`.
 *
 * @param {{ limit: string, price: string } | undefined} gas
 * @param {ContractGasSettings} fallback
 * @returns {ContractGasSettings}
 */
export function keptGas(gas, fallback) {
  try {
    return gas
      ? { gasLimit: BigInt(gas.limit), gasPrice: BigInt(gas.price) }
      : fallback;
  } catch {
    return fallback;
  }
}
