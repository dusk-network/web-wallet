import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decodeBase58 } from "@duskdomains/sdk";

const { createLensReader } = vi.hoisted(() => ({
  createLensReader: vi.fn(),
}));

// Only the lens reader is mocked, as in the resolveDuskName tests.
vi.mock("@duskdomains/sdk/lens-reader", () => ({ createLensReader }));

describe("getPrimaryName", () => {
  // A canonical compressed BLS12-381 G2 point: the generator times 7.
  const account =
    "qaJoSNfnh7kLyMPvFkWUPhzcAo2aDexVuGGjRZvghm31NPk7i8N57EFgKoYNBAicCfZVFm9icdcQYEoedS9jN5RZhYeuoSWbmomXdm7A1yUfPSUovheWccGYUvVkKCUnt7V";
  const otherAccount =
    "zTsZq814KfWUAQujzjBchbMEvqA1FiKBUakMCtAc2zCa74h9YVz4a2roYwS7LHDHeBwS1aap4f3GYhQBrxroYgsBcE4FJdkUbvpSD5LVXY6JRXNgMXgk6ckTPJUFKoHybff";
  const shieldedAddress =
    "47jNTgAhzn9KCKF3msCfvKg3k1P1QpPCLZ3HG3AoNp87sQ5WNS3QyjckYHWeuXqW7uvLmbKgejpP8Xkcip89vnMM";
  const otherShieldedAddress =
    "47jNTgAhzn9KCKF3msCfvKg3k1P1QpPCLZ3HG3AoNp87sQ5WNS3QyjckYHWeuXqW7uvLmbKgejpP8Xkcip89vnM";
  const nodeUrl = "https://testnet.nodes.dusk.network";
  const accountBytes = Array.from(decodeBase58(account) ?? []);

  /**
   * A reader that verifies `name` as the account's primary name, and
   * resolves it to the account and, if given, a shielded address.
   *
   * @param {string} name
   * @param {string} [phoenix]
   */
  const readerWith = (name, phoenix) => ({
    resolve: vi.fn().mockResolvedValue({
      height: 1n,
      records: [
        { key: "moonlight_address", value: accountBytes },
        phoenix
          ? {
              key: "phoenix_payment_endpoint",
              value: Array.from(new TextEncoder().encode(phoenix)),
            }
          : null,
      ],
      status: "Active",
    }),
    verifyPrimary: vi
      .fn()
      .mockResolvedValue(
        name ? { height: 1n, primary: { spelling: name } } : null
      ),
  });

  /** @type {typeof import("..").getPrimaryName} */
  let getPrimaryName;

  beforeEach(async () => {
    // Each test starts without the memoised readers and lookups.
    vi.resetModules();
    ({ getPrimaryName } = await import(".."));
  });

  afterEach(() => {
    createLensReader.mockReset();
    localStorage.clear();
    vi.useRealTimers();
  });

  it("should look up the verified primary name of a public account, passing its key as plain bytes", async () => {
    const reader = readerWith("alice.dusk");

    createLensReader.mockResolvedValue(reader);

    await expect(getPrimaryName(account, "testnet", nodeUrl)).resolves.toBe(
      "alice.dusk"
    );
    expect(reader.verifyPrimary).toHaveBeenCalledExactlyOnceWith(accountBytes);
    expect(Array.isArray(reader.verifyPrimary.mock.calls[0][0])).toBe(true);
  });

  it("should give no name to an account without a verified primary name", async () => {
    createLensReader.mockResolvedValue(readerWith(""));

    await expect(getPrimaryName(account, "testnet", nodeUrl)).resolves.toBe("");
  });

  it("should look nothing up on other networks", async () => {
    for (const network of ["devnet", "localnet", "unknown"]) {
      await expect(getPrimaryName(account, network, nodeUrl)).resolves.toBe("");
      await expect(
        getPrimaryName(account, network, nodeUrl, shieldedAddress)
      ).resolves.toBe("");
    }

    expect(createLensReader).not.toHaveBeenCalled();
  });

  it("should reuse a lookup for a minute, per network and account", async () => {
    const testnetReader = readerWith("alice.dusk");
    const mainnetReader = readerWith("alice.dusk");

    vi.useFakeTimers();
    createLensReader
      .mockResolvedValueOnce(testnetReader)
      .mockResolvedValueOnce(mainnetReader);

    await getPrimaryName(account, "testnet", nodeUrl);
    await getPrimaryName(account, "testnet", nodeUrl);
    await getPrimaryName(otherAccount, "testnet", nodeUrl);
    await getPrimaryName(account, "mainnet", "https://nodes.dusk.network");

    expect(testnetReader.verifyPrimary).toHaveBeenCalledTimes(2);
    expect(mainnetReader.verifyPrimary).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(60_000);
    await getPrimaryName(account, "testnet", nodeUrl);

    expect(testnetReader.verifyPrimary).toHaveBeenCalledTimes(3);
  });

  it("should keep the outcome of a public account's lookup that worked, until another one works", async () => {
    const { getVerifiedName } = await import("..");
    const reader = readerWith("alice.dusk");

    vi.useFakeTimers();
    createLensReader.mockResolvedValue(reader);

    expect(getVerifiedName("testnet", account)).toBe("");

    await getPrimaryName(account, "testnet", nodeUrl);

    expect(getVerifiedName("testnet", account)).toBe("alice.dusk");
    expect(getVerifiedName("mainnet", account)).toBe("");
    expect(getVerifiedName("testnet", otherAccount)).toBe("");

    reader.verifyPrimary.mockRejectedValueOnce(new Error("Node unreachable"));
    vi.advanceTimersByTime(60_000);

    await expect(getPrimaryName(account, "testnet", nodeUrl)).rejects.toThrow();
    expect(getVerifiedName("testnet", account)).toBe("alice.dusk");

    reader.verifyPrimary.mockResolvedValueOnce(null);

    await expect(getPrimaryName(account, "testnet", nodeUrl)).resolves.toBe("");
    expect(getVerifiedName("testnet", account)).toBe("");
  });

  it("should look a name up again after a lookup failed", async () => {
    const reader = readerWith("alice.dusk");

    reader.verifyPrimary.mockRejectedValueOnce(
      new Error("The lens reader took over 15000 ms")
    );
    createLensReader
      .mockRejectedValueOnce(new Error("The lens driver did not load"))
      .mockResolvedValue(reader);

    await expect(getPrimaryName(account, "testnet", nodeUrl)).rejects.toThrow(
      "The lens driver did not load"
    );
    await expect(getPrimaryName(account, "testnet", nodeUrl)).rejects.toThrow(
      "The lens reader took over 15000 ms"
    );
    await expect(getPrimaryName(account, "testnet", nodeUrl)).resolves.toBe(
      "alice.dusk"
    );
    expect(reader.verifyPrimary).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["is the shielded address", shieldedAddress, "alice.dusk"],
    ["is another shielded address", otherShieldedAddress, ""],
    ["isn't a shielded address", account, ""],
    ["is missing", undefined, ""],
  ])(
    "should show the name with a shielded address only if its phoenix_payment_endpoint record %s",
    async (_, phoenix, expected) => {
      const reader = readerWith("alice.dusk", phoenix);

      createLensReader.mockResolvedValue(reader);

      await expect(
        getPrimaryName(account, "testnet", nodeUrl, shieldedAddress)
      ).resolves.toBe(expected);
      await expect(getPrimaryName(account, "testnet", nodeUrl)).resolves.toBe(
        "alice.dusk"
      );
      expect(reader.resolve).toHaveBeenCalledExactlyOnceWith("alice.dusk", [
        "moonlight_address",
        "phoenix_payment_endpoint",
      ]);

      // The account's own lookup is reused, through the one reader.
      expect(reader.verifyPrimary).toHaveBeenCalledTimes(1);
      expect(createLensReader).toHaveBeenCalledTimes(1);
    }
  );

  it("should resolve nothing for the shielded address of an account without a name", async () => {
    const reader = readerWith("");

    createLensReader.mockResolvedValue(reader);

    await expect(
      getPrimaryName(account, "testnet", nodeUrl, shieldedAddress)
    ).resolves.toBe("");
    expect(reader.resolve).not.toHaveBeenCalled();
  });

  it("should check the shielded address again after its lookup failed", async () => {
    const reader = readerWith("alice.dusk", shieldedAddress);

    reader.resolve.mockRejectedValueOnce(
      new Error("Lens resolve query failed")
    );
    createLensReader.mockResolvedValue(reader);

    await expect(
      getPrimaryName(account, "testnet", nodeUrl, shieldedAddress)
    ).rejects.toThrow("Couldn't look up alice.dusk");
    await expect(
      getPrimaryName(account, "testnet", nodeUrl, shieldedAddress)
    ).resolves.toBe("alice.dusk");
    expect(reader.resolve).toHaveBeenCalledTimes(2);
    expect(reader.verifyPrimary).toHaveBeenCalledTimes(1);
  });
});
