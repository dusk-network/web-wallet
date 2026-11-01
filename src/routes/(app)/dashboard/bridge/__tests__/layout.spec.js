import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/svelte";
import { tick } from "svelte";

import { rememberMigration } from "$lib/bridge/migrationActivity";
import { keepIncarnation, useWalletDataSuffix } from "$lib/wallets/dataNames";

import BridgeLayout from "../+layout.svelte";

const MIGRATIONS = `${CONFIG.LOCAL_STORAGE_APP_KEY}-migrations:k`;
const UNKEPT =
  "This browser's storage is full, so new Bridge activity isn't kept here.";
const migration = {
  amountLux: "1",
  createdAt: 1,
  hash: `0x${"a".repeat(64)}`,
  recipient: "r",
  routeId: "bsc-to-dusk",
  sender: "s",
};

/** A wallet kept from before incarnations unlocks: whether it has one. */
async function unlock() {
  const kept = await keepIncarnation("k");

  useWalletDataSuffix(":k", "k");

  return kept;
}

describe("Bridge", () => {
  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  it("says new activity isn't kept, and keeps none, for a wallet from before unlocked with storage full, until it unlocks with room", async () => {
    const full = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new DOMException(
          "The quota has been exceeded.",
          "QuotaExceededError"
        );
      });

    expect(await unlock()).toBe(false);

    const { container } = render(BridgeLayout);

    expect(container.textContent).toContain(UNKEPT);

    full.mockRestore();
    rememberMigration(migration);

    expect(localStorage.getItem(MIGRATIONS)).toBeNull();

    // It locks, and unlocks with room.
    useWalletDataSuffix("", "", false);

    expect(await unlock()).toBe(true);

    await tick();
    rememberMigration(migration);

    expect(container.textContent).not.toContain(UNKEPT);
    expect(JSON.parse(localStorage.getItem(MIGRATIONS) ?? "[]")).toMatchObject([
      migration,
    ]);
  });
});
