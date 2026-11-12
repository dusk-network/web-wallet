/**
 * The sends that haven't gone out yet, wherever the wallet is: each from when
 * it's sent until the node is asked to broadcast it, it's called off, or it
 * ends. Home says each waits, with Cancel (sendGate).
 */

import { writable } from "svelte/store";

import { BALANCE_MASK } from "$lib/constants";
import { formatDuskExact } from "$lib/dusk/currency";

/**
 * A send waiting to go out: the DUSK it sends, in Lux, to whom, as "your
 * Profile 2", what calls it off, while it can be, and whether it waits for
 * the network, which it couldn't reach. Its amount is said as balances are
 * shown when it's said (waitingText), not as they were when it was sent.
 *
 * @typedef {{ cancel: (reason?: Error) => boolean, id: string, lux: bigint, to: string, waitsForNetwork: boolean }} WaitingSend
 */

/** @type {import("svelte/store").Writable<WaitingSend[]>} */
const sends = writable([]);

/** The sends waiting to go out, the oldest first. */
export const waitingSends = { subscribe: sends.subscribe };

/**
 * What a waiting send sends, as "0.01 DUSK to your Profile 2": its amount
 * hidden while balances are.
 *
 * @param {Pick<WaitingSend, "lux" | "to">} send
 * @param {{ hidden: boolean, locale: string }} shown How balances are shown now
 */
export const waitingText = ({ lux, to }, { hidden, locale }) =>
  `${hidden ? BALANCE_MASK : formatDuskExact(lux, locale)} DUSK to ${to}`;

/**
 * Says a send waits to go out, until it does, is called off or ends.
 *
 * @param {{ gate: import("./sendGate").SendGate, lux: bigint, operation: Promise<unknown>, to: string }} send
 */
export function keepWaiting({ gate, lux, operation, to }) {
  const id = crypto.randomUUID();
  let isWaiting = true;

  /** @type {Array<() => void>} */
  let stops = [];

  const stopFollowing = () => stops.forEach((stop) => stop());

  const done = () => {
    if (isWaiting) {
      isWaiting = false;
      sends.update((list) => list.filter((each) => each.id !== id));
      stopFollowing();
    }
  };

  sends.update((list) => [
    ...list,
    {
      cancel: (/** @type {Error | undefined} */ reason) => gate.cancel(reason),
      id,
      lux,
      to,
      waitsForNetwork: false,
    },
  ]);
  stops = [
    gate.subscribe((state) => {
      if (state !== "open") {
        done();
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

  operation.then(done, done);
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
