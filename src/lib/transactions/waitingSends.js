/**
 * The sends that haven't gone out yet, wherever the wallet is: each from when
 * it's sent until the node is asked to broadcast it, it's called off, or it
 * ends. Home says each waits, with Cancel (sendGate). One kept on this device
 * meanwhile ($lib/transactions/unsentSends) stays kept where it never went
 * out and nothing said so: as its page closed, reloaded or locked first. It's
 * kept as handed over, with its transaction's hash and nonce, before the node
 * is asked to broadcast it, and until it ends: its page may go before then.
 */

import { writable } from "svelte/store";

import SendPasswordDeclinedError from "$lib/errors/send-password-declined-error";
import WalletChangedError from "$lib/errors/wallet-changed-error";
import { BALANCE_MASK } from "$lib/constants";
import { formatDuskExact } from "$lib/dusk/currency";

import { SendCancelledError } from "./sendGate";
import { keepUnsent } from "./unsentSends";

/**
 * A send waiting to go out: the DUSK it sends, in Lux, to whom, as "your
 * Profile 2", and to which address, from which of the wallet's accounts or
 * addresses, with what memo, when it was sent, the most its fee can be, what
 * calls it off, while it can be, and whether it waits for the network, which
 * it couldn't reach. Its amount is said as balances are shown when it's said
 * (waitingText), not as they were when it was sent.
 *
 * @typedef {{
 *   address: string,
 *   at: number,
 *   cancel: (reason?: Error) => boolean,
 *   from: string,
 *   id: string,
 *   lux: bigint,
 *   maxFee: bigint,
 *   memo: string,
 *   to: string,
 *   waitsForNetwork: boolean,
 * }} WaitingSend
 */

/** @type {import("svelte/store").Writable<WaitingSend[]>} */
const sends = writable([]);

/** The sends waiting to go out, the oldest first. */
export const waitingSends = { subscribe: sends.subscribe };

/**
 * What a waiting send sends, as "0.01 DUSK to your Profile 2": its amount
 * hidden while balances are.
 *
 * @param {{ lux: bigint | string, to: string }} send
 * @param {{ hidden: boolean, locale: string }} shown How balances are shown now
 */
export const waitingText = ({ lux, to }, { hidden, locale }) =>
  `${hidden ? BALANCE_MASK : formatDuskExact(BigInt(lux), locale)} DUSK to ${to}`;

/**
 * Whether a send that ended without going out is kept, to be said as one
 * that never went out: not where the person called it off, or turned down
 * the password it asked for, nor where its own screen says it failed. Where
 * the wallet locked or another opened, no screen of it says anything.
 *
 * @param {unknown} why
 * @param {() => boolean} isSaid Whether its own screen says how it ended
 */
const isKeptAfter = (why, isSaid) =>
  why instanceof WalletChangedError ||
  !(
    why instanceof SendCancelledError ||
    why instanceof SendPasswordDeclinedError ||
    isSaid()
  );

/**
 * Says a send waits to go out, until it does, is called off or ends. With
 * `kept`, it's kept on this device meanwhile, for the wallet and network
 * open: one that ends without going out, as its page closes, reloads or
 * locks, stays kept, and is said once the wallet opens again, unless the
 * person called it off or its own screen said how it ended (`kept.isSaid`).
 * Before the node is asked to broadcast it, it's kept as handed over, and
 * it goes out only once it is: one whose page goes from then on may have
 * gone out, and is never said as one that didn't. It's forgotten as it ends.
 * One sent again from what's kept of it takes its place (`kept.id`).
 *
 * @param {{
 *   address?: string,
 *   from?: string,
 *   gate: import("./sendGate").SendGate,
 *   kept?: { account: string, id?: string, isSaid: () => boolean, network: string, typed: Record<string, unknown> },
 *   lux: bigint,
 *   maxFee?: bigint,
 *   memo?: string,
 *   operation: Promise<unknown>,
 *   to: string,
 * }} send
 */
export function keepWaiting({
  address = "",
  from = "",
  gate,
  kept,
  lux,
  maxFee = 0n,
  memo = "",
  operation,
  to,
}) {
  const id = kept?.id || crypto.randomUUID();
  const at = Date.now();
  let isWaiting = true;

  /** Whether the node may have been asked to broadcast it. */
  let isHandedOver = false;

  /** @type {Array<() => void>} */
  let stops = [];

  const stopFollowing = () => stops.forEach((stop) => stop());

  const keeping = kept
    ? keepUnsent({
        account: kept.account,
        at,
        id,
        label: to,
        lux: String(lux),
        memo,
        network: kept.network,
        to: address,
        typed: kept.typed,
      })
    : null;

  // Kept as handed over before it can go out, or it doesn't.
  if (keeping) {
    gate.keepFirst((sent) => keeping.handOver(sent));
  }

  /** No longer waiting: gone out, called off or ended. */
  const leave = () => {
    if (isWaiting) {
      isWaiting = false;
      sends.update((list) => list.filter((each) => each.id !== id));
      stopFollowing();
    }
  };

  /**
   * Ended: kept, as one that never went out, or not.
   *
   * @param {boolean} keep
   */
  const done = (keep) => {
    keeping?.end(keep);
    leave();
  };

  sends.update((list) => [
    ...list,
    {
      address,
      at,
      cancel: (/** @type {Error | undefined} */ reason) => gate.cancel(reason),
      from,
      id,
      lux,
      maxFee,
      memo,
      to,
      waitsForNetwork: false,
    },
  ]);
  stops = [
    gate.subscribe((state) => {
      if (state === "handed-over") {
        // It may go out from now on: History shows it. What's kept of it
        // says so until it ends.
        isHandedOver = true;
        leave();
      } else if (state === "cancelled") {
        let why;

        try {
          gate.check();
        } catch (error) {
          why = error;
        }

        done(isKeptAfter(why, () => false));
      }
    }),
    gate.waitsForNetwork.subscribe((waits) => {
      if (isWaiting) {
        sends.update((list) =>
          list.map((each) =>
            each.id === id ? { ...each, waitsForNetwork: waits } : each
          )
        );
      }
    }),
  ];

  // Gone out or called off already as it was followed.
  if (!isWaiting) {
    stopFollowing();
  }

  // Once handed over, its own screen and History say what became of it.
  operation.then(
    () => done(false),
    (error) =>
      done(!isHandedOver && isKeptAfter(error, () => kept?.isSaid() ?? true))
  );
}

/**
 * Calls off every send that hasn't gone out, as the wallet locks or another
 * opens, for `reason`: a send goes out only while the wallet it began on is
 * open.
 *
 * @param {Error} [reason]
 */
export function cancelWaitingSends(reason) {
  let waiting = /** @type {WaitingSend[]} */ ([]);

  sends.update((list) => {
    waiting = list;

    return [];
  });

  for (const send of waiting) {
    send.cancel(reason);
  }
}
