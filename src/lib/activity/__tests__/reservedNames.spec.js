import { afterEach, describe, expect, it, vi } from "vitest";
import { get, writable } from "svelte/store";

import * as sdk from "@duskdomains/sdk";

import { nameCommitOf } from "../knownContracts";
import reservedNames, {
  reservationNames,
  revealedName,
} from "../reservedNames";

import { calls as REGISTRATIONS } from "./fixtures/registrations-testnet.json";

const wallet = vi.hoisted(() => ({ account: "" }));

vi.mock("$lib/stores", async (importOriginal) => {
  /** @type {typeof import("$lib/stores")} */
  const original = await importOriginal();

  return {
    ...original,
    walletStore: {
      ...original.walletStore,
      /** @param {(value: any) => void} run */
      subscribe(run) {
        return writable({
          currentProfile: { account: wallet.account },
        }).subscribe(run);
      },
    },
  };
});

const [ALICE] = REGISTRATIONS;

/**
 * The account that registered alice.dusk on testnet: the one its record
 * names, after the record's key.
 */
const OWNER = sdk.encodeBase58(
  Uint8Array.from(ALICE.data.match(/../g) ?? [], (b) => parseInt(b, 16)).slice(
    "moonlight_address".length,
    "moonlight_address".length + 96
  )
);

/** Another testnet account. */
const OTHER =
  "21n5ncyuJkRr9JRoxvWRLMcqcWxmVSSLdefDMTwQeNyZZikU5dcXuawf9kNuG1CxFvz32oBM965PQ2PCcWrwX8YX9a7fqaaQ6fabDhxW5mveEyAt4LgdY3KLH9iKtSfMMLNz";

/** alice.dusk's registration, as the history has it. */
const registration = /** @type {ActivityRow} */ ({
  blockHeight: ALICE.blockHeight,
  contractId: ALICE.contractId,
  fnName: "register",
  hash: ALICE.hash,
  nameCommit: nameCommitOf(ALICE),
  registeredName: "alice.dusk",
  source: "archive",
  status: "executed",
});

/** Its reservation: the commitment the registration reveals. */
const reservation = /** @type {ActivityRow} */ ({
  blockHeight: ALICE.blockHeight - 20,
  contractId: ALICE.contractId,
  fnName: "commit",
  hash: "c0".repeat(32),
  nameCommit: { commitment: nameCommitOf(ALICE)?.commitment ?? "" },
  source: "archive",
  status: "executed",
});

describe("revealedName", () => {
  it("should give the name a registration reveals, for the account that sent it only", () => {
    expect(revealedName(registration, OWNER, sdk)).toBe("alice.dusk");
    expect(revealedName(registration, OTHER, sdk)).toBeNull();
    expect(revealedName(registration, "not an account", sdk)).toBeNull();
  });

  it("should give none where what it reveals doesn't make its commitment", () => {
    const commit = /** @type {import("../knownContracts").NameCommit} */ (
      registration.nameCommit
    );

    for (const nameCommit of [
      { ...commit, secret: "00".repeat(32) },
      { ...commit, node: "00".repeat(32) },
      { ...commit, commitment: "00".repeat(32) },
      { commitment: commit.commitment },
    ]) {
      expect(revealedName({ ...registration, nameCommit }, OWNER, sdk)).toBe(
        null
      );
    }

    expect(
      revealedName({ ...registration, registeredName: "bob.dusk" }, OWNER, sdk)
    ).toBeNull();
  });
});

describe("reservationNames", () => {
  /** @param {ActivityRow} row */
  const reveals = (row) => revealedName(row, OWNER, sdk);

  it("should name a reservation by the registration after it that reveals it", () => {
    expect(
      reservationNames([registration, reservation], reveals)
    ).toStrictEqual(new Map([[reservation.hash, "alice.dusk"]]));

    // Pending: a registration not in a block yet comes after one that is,
    // and two not in one yet go by when they were sent.
    const pending = {
      ...registration,
      blockHeight: undefined,
      source: /** @type {const} */ ("local"),
      submittedAt: 2,
    };

    expect(reservationNames([pending, reservation], reveals).size).toBe(1);
    expect(
      reservationNames(
        [
          pending,
          {
            ...reservation,
            blockHeight: undefined,
            source: "local",
            submittedAt: 1,
          },
        ],
        reveals
      ).size
    ).toBe(1);
  });

  it("should name no reservation that no registration after it reveals", () => {
    // After its registration, or another commitment, or not revealed.
    expect(
      reservationNames(
        [{ ...reservation, blockHeight: ALICE.blockHeight + 1 }, registration],
        reveals
      ).size
    ).toBe(0);
    expect(
      reservationNames(
        [
          registration,
          { ...reservation, nameCommit: { commitment: "00".repeat(32) } },
        ],
        reveals
      ).size
    ).toBe(0);
    expect(reservationNames([registration, reservation], () => null).size).toBe(
      0
    );
  });
});

describe("reservedNames", () => {
  afterEach(() => {
    wallet.account = "";
  });

  it("should work the names out for the account the wallet shows", async () => {
    wallet.account = OWNER;
    await reservedNames.load([registration, reservation]);

    expect(get(reservedNames)).toStrictEqual(
      new Map([[reservation.hash, "alice.dusk"]])
    );

    // Another profile's history reveals none of them.
    wallet.account = OTHER;
    await reservedNames.load([registration, reservation]);

    expect(get(reservedNames).size).toBe(0);
  });
});
