import { describe, expect, it } from "vitest";

import { getShieldedPausedMessage } from "..";

describe("getShieldedPausedMessage", () => {
  it("should name the network as the wallet shows it", () => {
    expect(getShieldedPausedMessage("mainnet")).toBe(
      "Shielded transactions are paused on Mainnet."
    );
    expect(getShieldedPausedMessage("testnet")).toBe(
      "Shielded transactions are paused on Testnet."
    );
  });

  it("should say 'this network' when the wallet doesn't know the network's name", () => {
    expect(getShieldedPausedMessage("unknown")).toBe(
      "Shielded transactions are paused on this network."
    );
    expect(getShieldedPausedMessage("")).toBe(
      "Shielded transactions are paused on this network."
    );
  });
});
