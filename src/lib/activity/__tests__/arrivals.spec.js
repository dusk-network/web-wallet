import { afterEach, describe, expect, it } from "vitest";
import { get } from "svelte/store";

import {
  LOOK_FOR_MS,
  arrivalsNotIn,
  awaitArrival,
  awaitedArrivals,
  forgetArrivals,
  isToAnotherProfile,
} from "../arrivals";

const ONE = { account: "account-1", address: "address-1" };
const TWO = { account: "account-2", address: "address-2" };

describe("Payments to another profile here, looked for", () => {
  afterEach(() => forgetArrivals());

  it("are those to another profile of the wallet, public or shielded, and none to the profile itself or to anyone else", () => {
    const profiles = [ONE, TWO];

    expect(isToAnotherProfile("account-2", ONE, profiles)).toBe(true);
    expect(isToAnotherProfile("address-2", ONE, profiles)).toBe(true);
    expect(isToAnotherProfile("account-1", ONE, profiles)).toBe(false);
    expect(isToAnotherProfile("address-1", ONE, profiles)).toBe(false);
    expect(isToAnotherProfile("someone", ONE, profiles)).toBe(false);
    expect(isToAnotherProfile(undefined, ONE, profiles)).toBe(false);
  });

  it("are looked for by their hash in any case, two minutes from when they went out, until the rows have them", () => {
    awaitArrival({ hash: "AB".repeat(32), to: "account-2" });
    awaitArrival({ hash: "cd".repeat(32), to: "address-2" });

    const awaited = get(awaitedArrivals);
    const [{ at }] = awaited;

    expect(awaited.map(({ hash, to }) => [hash, to])).toStrictEqual([
      ["ab".repeat(32), "account-2"],
      ["cd".repeat(32), "address-2"],
    ]);

    // By the profile's addresses, until a row has it.
    expect(arrivalsNotIn(awaited, ["account-2"], [], at)).toHaveLength(1);
    expect(
      arrivalsNotIn(awaited, ["account-2", "address-2"], [], at)
    ).toHaveLength(2);
    expect(arrivalsNotIn(awaited, ["account-1"], [], at)).toHaveLength(0);
    expect(
      arrivalsNotIn(awaited, ["account-2"], [{ hash: "ab".repeat(32) }], at)
    ).toHaveLength(0);

    // Two minutes on, looked for no more.
    expect(
      arrivalsNotIn(awaited, ["account-2"], [], at + LOOK_FOR_MS)
    ).toHaveLength(0);

    // The same one again is looked for once, from then.
    awaitArrival({ hash: "ab".repeat(32), to: "account-2" });

    expect(get(awaitedArrivals)).toHaveLength(2);
  });
});
