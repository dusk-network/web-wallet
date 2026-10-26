import { describe, expect, it, vi } from "vitest";
import { createAppKit } from "@reown/appkit";

import "../walletConnection";

describe("walletConnection", () => {
  it("should offer wallets only to connect, with no email or social logins", () => {
    expect(vi.mocked(createAppKit)).toHaveBeenCalledOnce();
    expect(vi.mocked(createAppKit).mock.calls[0][0].features).toMatchObject({
      email: false,
      socials: false,
    });
  });
});
