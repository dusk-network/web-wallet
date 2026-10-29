import { describe, expect, it } from "vitest";
import { get } from "svelte/store";

import reservedNames, { reservationNames } from "../reservedNames";

const STORE =
  "4e2de1ed4f1fd53de83f4809a75367301c7645a546030fa199aff804e6854199";
const COMMITMENT = "c0".repeat(32);

/**
 * A name's registration, as the history has it: checked for its account,
 * it reveals `reservation`.
 *
 * @param {Partial<ActivityRow>} fields
 * @param {string | null} [reservation]
 * @returns {ActivityRow}
 */
const registration = (fields, reservation = COMMITMENT) => ({
  blockHeight: 100,
  contractId: STORE,
  fnName: "register",
  hash: "d1".repeat(32),
  nameCommit: {
    kind: "registration",
    name: "alice.dusk",
    reservation,
    role: "store",
  },
  registeredName: "alice.dusk",
  source: "archive",
  status: "executed",
  ...fields,
});

/**
 * Its reservation, of `commitment`.
 *
 * @param {Partial<ActivityRow>} fields
 * @param {string} [commitment]
 * @returns {ActivityRow}
 */
const reservation = (fields, commitment = COMMITMENT) => ({
  blockHeight: 80,
  contractId: STORE,
  fnName: "commit",
  hash: "c1".repeat(32),
  nameCommit: { kind: "reservation", reservation: commitment, role: "store" },
  source: "archive",
  status: "executed",
  ...fields,
});

describe("reservationNames", () => {
  it("should name a reservation by the registration after it that reveals it", () => {
    expect(reservationNames([registration({}), reservation({})])).toStrictEqual(
      new Map([["c1".repeat(32), "alice.dusk"]])
    );

    // Pending: a registration not in a block yet comes after one that is,
    // and two not in one yet go by when they were sent.
    const pending = registration({
      blockHeight: undefined,
      source: "local",
      submittedAt: 2,
    });

    expect(reservationNames([pending, reservation({})]).size).toBe(1);
    expect(
      reservationNames([
        pending,
        reservation({
          blockHeight: undefined,
          source: "local",
          submittedAt: 1,
        }),
      ]).size
    ).toBe(1);
  });

  it("should name no reservation that no registration after it reveals", () => {
    // After its registration, of another commitment, or not revealed for
    // the history's account.
    for (const rows of [
      [registration({}), reservation({ blockHeight: 101 })],
      [registration({}), reservation({}, "00".repeat(32))],
      [registration({}, null), reservation({})],
    ]) {
      expect(reservationNames(rows).size).toBe(0);
    }
  });
});

describe("reservedNames", () => {
  it("should work the names out for the rows shown", () => {
    reservedNames.load([registration({}), reservation({})]);

    expect(get(reservedNames)).toStrictEqual(
      new Map([["c1".repeat(32), "alice.dusk"]])
    );

    reservedNames.load([reservation({})]);

    expect(get(reservedNames).size).toBe(0);
  });
});
