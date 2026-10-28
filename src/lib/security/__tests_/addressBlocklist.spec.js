import { afterEach, describe, expect, it } from "vitest";
import { networks } from "@dusk-network/networks";

import { setNodeNetwork } from "$lib/stores/nodeNetwork";

import { getBlocklistedRecipient } from "../addressBlocklist";

describe("addressBlocklist", () => {
  const [compromised, scam] = networks.mainnet.display.blocklist;

  afterEach(() => {
    setNodeNetwork(null);
  });

  it("should refuse the recipients the network's file lists, saying why", () => {
    setNodeNetwork(networks.mainnet);

    expect(getBlocklistedRecipient(` ${compromised.account} `)).toStrictEqual({
      address: compromised.account,
      reason:
        "Transfer restricted: this recipient address has been reported as compromised.",
    });
    expect(getBlocklistedRecipient(scam.account)?.reason).toMatch(
      /fraud\/scam/
    );
    expect(getBlocklistedRecipient("someone-else")).toBeUndefined();
    expect(getBlocklistedRecipient("")).toBeUndefined();
  });

  it("should refuse them on any network while the node's isn't known", () => {
    expect(getBlocklistedRecipient(compromised.account)).toMatchObject({
      address: compromised.account,
    });
  });
});
