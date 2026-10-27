import { describe, expect, it, vi } from "vitest";
import { createAppKit } from "@reown/appkit";

import { startWalletConnection } from "../walletConnection";

describe("walletConnection", () => {
  it("should start nothing until a page asks for it: no requests to Reown, WalletConnect or Coinbase", () => {
    expect(vi.mocked(createAppKit)).not.toHaveBeenCalled();
  });

  it("should then offer wallets only, without analytics or the Coinbase SDKs' telemetry, once", async () => {
    await startWalletConnection();
    await startWalletConnection();

    expect(vi.mocked(createAppKit)).toHaveBeenCalledOnce();
    expect(vi.mocked(createAppKit).mock.calls[0][0]).toMatchObject({
      enableBaseAccount: false,
      enableCoinbase: false,
      features: { analytics: false, email: false, socials: false },
    });
  });
});
