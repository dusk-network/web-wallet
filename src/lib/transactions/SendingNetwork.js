import { Network } from "@dusk/w3sper";

import { outcomeUnknown } from "./outcomeUnknown";

/**
 * The network as the wallet sends on it, which tells a send that failed
 * before its transaction was handed to the node from one that may have
 * gone out. Building it, proving it and the node's check of it (preverify)
 * come first, and a failure there sends nothing. Once the node was asked
 * to broadcast it (propagate), its answer may be what got lost: what the
 * send ran into from then on is marked (outcomeUnknown).
 */
export default class SendingNetwork extends Network {
  /**
   * The transactions the node was asked to broadcast, by their bytes.
   *
   * @type {WeakSet<object>}
   */
  #broadcasts = new WeakSet();

  /**
   * @param {URL} url
   * @param {object} [options]
   */
  constructor(url, options = {}) {
    super(url, options);

    const broadcasts = this.#broadcasts;
    const { transactions } = this;
    const propagate = transactions.propagate.bind(transactions);

    transactions.propagate = (/** @type {any} */ tx) => {
      broadcasts.add(tx);

      return propagate(tx);
    };
  }

  /**
   * Builds, checks and broadcasts a transaction, as w3sper does.
   *
   * @template {import("@dusk/w3sper").BasicTransfer} T
   * @param {T} tx A transaction's builder
   * @returns {ReturnType<T["build"]>}
   */
  execute(tx) {
    /** @type {any} */
    let built = tx;

    // The transaction its builder makes, to know it by its bytes.
    const watched = new Proxy(tx, {
      get(target, property) {
        const value = Reflect.get(target, property);

        if (property === "build" && typeof value === "function") {
          return async (/** @type {unknown} */ network) =>
            (built = await value.call(target, network));
        }

        return typeof value === "function" ? value.bind(target) : value;
      },
    });

    return /** @type {ReturnType<T["build"]>} */ (
      super.execute(watched).catch((/** @type {unknown} */ error) => {
        throw this.#broadcasts.has(built?.buffer)
          ? outcomeUnknown(error)
          : error;
      })
    );
  }
}
