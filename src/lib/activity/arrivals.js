/**
 * Payments this wallet sent to another of its profiles, from when they went
 * out: the archive has one only some seconds after a block took it, so the
 * history of the profile it pays reads the archive again every few seconds
 * until it has it, and that profile's requests say they're checking
 * meanwhile, never that nothing came in. Each is looked for two minutes at
 * most.
 */

import { writable } from "svelte/store";

/** How long a payment is looked for, from when it went out. */
export const LOOK_FOR_MS = 120_000;

/**
 * A payment looked for: its hash, lower case, the address it pays, and when
 * it went out.
 *
 * @typedef {{ at: number, hash: string, to: string }} AwaitedArrival
 */

/** @type {import("svelte/store").Writable<AwaitedArrival[]>} */
const awaited = writable([]);

/** The payments looked for, the oldest first. */
export const awaitedArrivals = { subscribe: awaited.subscribe };

/**
 * Looks for a payment to a profile here, as it goes out.
 *
 * @param {{ hash: string, to: string }} payment
 */
export function awaitArrival({ hash, to }) {
  const now = Date.now();
  const id = hash.toLowerCase();

  awaited.update((list) => [
    ...list.filter((each) => now - each.at < LOOK_FOR_MS && each.hash !== id),
    { at: now, hash: id, to },
  ]);
}

/**
 * Whether a payment from a profile goes to another profile of the same
 * wallet: to its public account or its shielded address.
 *
 * @param {string | undefined} to
 * @param {{ account: unknown, address: unknown }} from The profile it's sent from
 * @param {{ account: unknown, address: unknown }[]} profiles The wallet's
 */
export const isToAnotherProfile = (to, from, profiles) =>
  Boolean(to) &&
  to !== String(from.account) &&
  to !== String(from.address) &&
  profiles.some(
    ({ account, address }) => to === String(account) || to === String(address)
  );

/**
 * The payments to any of `addresses` still looked for, not in `rows` yet.
 *
 * @param {AwaitedArrival[]} arrivals
 * @param {string[]} addresses
 * @param {Pick<ActivityRow, "hash">[]} rows
 * @param {number} [now]
 * @returns {AwaitedArrival[]}
 */
export const arrivalsNotIn = (arrivals, addresses, rows, now = Date.now()) =>
  arrivals.filter(
    ({ at, hash, to }) =>
      now - at < LOOK_FOR_MS &&
      addresses.includes(to) &&
      !rows.some((row) => row.hash.toLowerCase() === hash)
  );

/** Looks for none, as another wallet opens or every one locks. */
export const forgetArrivals = () => awaited.set([]);
