/**
 * A payment request handed to the Dusk Wallet extension, where there's one
 * that takes it (`dusk_openPaymentLink`): found by Dusk Connect's discovery,
 * which needs no connection and tells the extension nothing of the person.
 */

/** How long the page waits for an extension to answer. */
const ANNOUNCE_MS = 3_000;

/**
 * @typedef {{ request: (args: { method: string, params?: unknown }) => Promise<unknown> }} DuskProvider
 */

/**
 * The extension's provider, where one answers Dusk Connect's discovery and
 * takes a payment link: null where none does, as one too old to.
 *
 * @param {number} [wait] How long to wait for one, in milliseconds
 * @returns {Promise<DuskProvider | null>}
 */
export function findLinkTaker(wait = ANNOUNCE_MS) {
  return new Promise((resolve) => {
    /** @type {Set<DuskProvider>} */
    const asked = new Set();

    /** @param {DuskProvider | null} provider */
    const finish = (provider) => {
      clearTimeout(timer);
      window.removeEventListener("dusk:announceProvider", take);
      resolve(provider);
    };

    /** @param {Event} event */
    const take = (event) => {
      const provider = /** @type {CustomEvent} */ (event).detail?.provider;

      if (typeof provider?.request !== "function" || asked.has(provider)) {
        return;
      }

      asked.add(provider);
      provider.request({ method: "dusk_getCapabilities" }).then(
        (/** @type {any} */ capabilities) => {
          if (capabilities?.methods?.includes?.("dusk_openPaymentLink")) {
            finish(provider);
          }
        },
        () => {}
      );
    };

    const timer = setTimeout(() => finish(null), wait);

    window.addEventListener("dusk:announceProvider", take);
    window.dispatchEvent(new Event("dusk:requestProvider"));
  });
}

/**
 * Hands a request link to the extension, from a press, as it asks: "opened"
 * where its own Send opened it, filled in, for its Review; "no-wallet" where
 * it has no wallet to pay with; "refused" where it won't take the link.
 *
 * @param {DuskProvider} provider
 * @param {string} link The request link the page was opened with
 * @returns {Promise<"no-wallet" | "opened" | "refused">}
 */
export async function openInExtension(provider, link) {
  try {
    const opened = await provider.request({
      method: "dusk_openPaymentLink",
      params: { link },
    });

    return opened === true ? "opened" : "no-wallet";
  } catch {
    return "refused";
  }
}
