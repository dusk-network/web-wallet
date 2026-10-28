import { afterEach, describe, expect, it } from "vitest";
import { networks } from "@dusk-network/networks";
import { base } from "$app/paths";

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

  it("opens the Bridge on the first migration into Dusk that's running, BNB Smart Chain's on mainnet", () => {
    setNodeNetwork(networks.mainnet);

    // Within the app, as deployed under its base path.
    expect(sentTo()).toMatchObject({
      location: `${base}/dashboard/bridge?route=bsc-to-dusk`,
      status: 307,
    });
  });

  it("opens the Bridge with no route where no migration is running, or there is none", () => {
    // Testnet's, from Sepolia, isn't running.
    setNodeNetwork(networks.testnet);

    expect(sentTo()?.location).toBe(`${base}/dashboard/bridge`);

    setNodeNetwork(networks.devnet);

    expect(sentTo()?.location).toBe(`${base}/dashboard/bridge`);
  });
});
