import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import releases from "../dusk-domains-releases.json";

const { createLensReader } = vi.hoisted(() => ({
  createLensReader: vi.fn(),
}));

// Only the lens reader is mocked: name validation, the BLS key check and
// Base58 are the SDK's own.
vi.mock("@duskdomains/sdk/lens-reader", () => ({ createLensReader }));

describe("resolveDuskName", () => {
  // A canonical compressed BLS12-381 G2 point: the generator times 7.
  const account =
    "qaJoSNfnh7kLyMPvFkWUPhzcAo2aDexVuGGjRZvghm31NPk7i8N57EFgKoYNBAicCfZVFm9icdcQYEoedS9jN5RZhYeuoSWbmomXdm7A1yUfPSUovheWccGYUvVkKCUnt7V";
  const nodeUrl = "https://testnet.nodes.dusk.network";

  /** @param {any} result */
  const readerResolving = (result) => ({
    resolveMoonlightAccount: vi
      .fn()
      .mockResolvedValue({ height: 1n, ...result }),
  });

  /** @type {typeof import("..").resolveDuskName} */
  let resolveDuskName;

  beforeEach(async () => {
    // Each test starts without the memoised readers.
    vi.resetModules();
    ({ resolveDuskName } = await import(".."));
  });

  afterEach(() => {
    createLensReader.mockReset();
  });

  it("should resolve an active name to the public account in its moonlight_address record", async () => {
    const reader = readerResolving({ account, status: "Active" });

    createLensReader.mockResolvedValue(reader);

    await expect(
      resolveDuskName(" Alice.dusk\n", "testnet", nodeUrl)
    ).resolves.toStrictEqual({ address: account, name: "alice.dusk" });
    expect(reader.resolveMoonlightAccount).toHaveBeenCalledExactlyOnceWith(
      "alice.dusk"
    );
  });

  it("should create one reader per network, from the pinned release and the wallet's node", async () => {
    createLensReader.mockResolvedValue(
      readerResolving({ account, status: "Active" })
    );

    await resolveDuskName("alice.dusk", "testnet", nodeUrl);
    await resolveDuskName("bob.dusk", "testnet", nodeUrl);
    await resolveDuskName(
      "alice.dusk",
      "mainnet",
      "https://nodes.dusk.network"
    );

    expect(createLensReader).toHaveBeenCalledTimes(2);
    expect(createLensReader).toHaveBeenNthCalledWith(1, releases.testnet, {
      artifactBaseUrl: "https://testnet.dusk.domains/",
      nodeUrl,
    });
    expect(createLensReader).toHaveBeenNthCalledWith(2, releases.mainnet, {
      artifactBaseUrl: "https://dusk.domains/",
      nodeUrl: "https://nodes.dusk.network",
    });
  });

  it("should report failed lookups, and retry a reader that failed to load", async () => {
    const reader = readerResolving({ account, status: "Active" });

    reader.resolveMoonlightAccount.mockRejectedValueOnce(
      new Error("The lens reader took over 15000 ms")
    );
    createLensReader
      .mockRejectedValueOnce(new Error("The lens driver did not load"))
      .mockResolvedValue(reader);

    for (const expected of [
      { error: "lookup-failed", name: "alice.dusk" },
      { error: "lookup-failed", name: "alice.dusk" },
      { address: account, name: "alice.dusk" },
    ]) {
      await expect(
        resolveDuskName("alice.dusk", "testnet", nodeUrl)
      ).resolves.toStrictEqual(expected);
    }

    // A failed read keeps the reader: only the failed creation is retried.
    expect(createLensReader).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["not-registered", "an absent name", { status: "Absent" }],
    ["expired", "a root in grace", { status: "Grace" }],
    ["expired", "a released root", { status: "Released" }],
    ["expired", "an expired subname", { status: "Expired" }],
    ["no-address", "a name without the record", { status: "Active" }],
    [
      "no-address",
      "a key-shaped record that isn't a valid key",
      { account: `${account.slice(0, -1)}W`, status: "Active" },
    ],
  ])("should report %s for %s", async (error, _, result) => {
    createLensReader.mockResolvedValue(readerResolving(result));

    await expect(
      resolveDuskName("alice.dusk", "testnet", nodeUrl)
    ).resolves.toStrictEqual({ error, name: "alice.dusk" });
  });

  it("should refuse invalid names and other networks without creating a reader", async () => {
    await expect(
      resolveDuskName("bad_name.dusk", "testnet", nodeUrl)
    ).resolves.toStrictEqual({ error: "invalid", name: "bad_name.dusk" });

    for (const network of ["devnet", "localnet", "unknown"]) {
      await expect(
        resolveDuskName("alice.dusk", network, nodeUrl)
      ).resolves.toStrictEqual({
        error: "unsupported-network",
        name: "alice.dusk",
      });
    }

    expect(createLensReader).not.toHaveBeenCalled();
  });
});
