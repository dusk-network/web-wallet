import { afterEach, describe, expect, it } from "vitest";
import { networks } from "@dusk-network/networks";

import { setNodeNetwork } from "$lib/stores/nodeNetwork";

import { load } from "../+page.js";

/** Where the page sends to: the redirect it throws. */
function sentTo() {
  try {
    load(/** @type {any} */ ({}));
  } catch (redirect) {
    return /** @type {{ location: string, status: number }} */ (redirect);
  }

  return null;
}

describe("Migrate", () => {
  afterEach(() => {
    setNodeNetwork(null);
  });

  it("opens the Bridge on the first migration into Dusk, BNB Smart Chain's on mainnet", () => {
    setNodeNetwork(networks.mainnet);

    expect(sentTo()).toMatchObject({
      location: "/dashboard/bridge?route=bsc-to-dusk",
      status: 307,
    });

    setNodeNetwork(networks.testnet);

    expect(sentTo()?.location).toBe("/dashboard/bridge?route=ethereum-to-dusk");
  });

  it("opens the Bridge as it is where the network has no migration", () => {
    setNodeNetwork(networks.devnet);

    expect(sentTo()?.location).toBe("/dashboard/bridge");
  });
});
