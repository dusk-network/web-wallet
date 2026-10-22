import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decodeBase58 } from "@duskdomains/sdk";

import releases from "../dusk-domains-releases.json";

const { createLensReader } = vi.hoisted(() => ({
  createLensReader: vi.fn(),
}));

// Only the lens reader is mocked: name validation, the BLS key check and
// Base58 are the SDK's own, and shielded addresses get the wallet's checks.
vi.mock("@duskdomains/sdk/lens-reader", () => ({ createLensReader }));

describe("resolveDuskName", () => {
  // A canonical compressed BLS12-381 G2 point: the generator times 7.
  const account =
    "qaJoSNfnh7kLyMPvFkWUPhzcAo2aDexVuGGjRZvghm31NPk7i8N57EFgKoYNBAicCfZVFm9icdcQYEoedS9jN5RZhYeuoSWbmomXdm7A1yUfPSUovheWccGYUvVkKCUnt7V";
  const address =
    "47jNTgAhzn9KCKF3msCfvKg3k1P1QpPCLZ3HG3AoNp87sQ5WNS3QyjckYHWeuXqW7uvLmbKgejpP8Xkcip89vnMM";
  const invalidKey = `${account.slice(0, -1)}W`;
  const nodeUrl = "https://testnet.nodes.dusk.network";
  const recordKeys = ["moonlight_address", "phoenix_payment_endpoint"];

  /** @param {string} text */
  const utf8 = (text) => Array.from(new TextEncoder().encode(text));

  /**
   * A reader resolving a name with these records: the public account
   * as its key's bytes and the shielded address as text, as stored.
   *
   * @param {{ moonlight?: string, phoenix?: string | number[], status: string }} name
   */
  const readerResolving = ({ moonlight, phoenix, status }) => ({
    resolve: vi.fn().mockResolvedValue({
      height: 1n,
      records: [
        moonlight
          ? {
              key: "moonlight_address",
              value: Array.from(decodeBase58(moonlight) ?? []),
            }
          : null,
        phoenix
          ? {
              key: "phoenix_payment_endpoint",
              value: typeof phoenix === "string" ? utf8(phoenix) : phoenix,
            }
          : null,
      ],
      status,
    }),
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

  it("should resolve an active name to the public account and the shielded address in its records, in one lookup", async () => {
    const reader = readerResolving({
      moonlight: account,
      phoenix: address,
      status: "Active",
    });

    createLensReader.mockResolvedValue(reader);

    await expect(
      resolveDuskName(" Alice.dusk\n", "testnet", nodeUrl)
    ).resolves.toStrictEqual({ account, address, name: "alice.dusk" });
    expect(reader.resolve).toHaveBeenCalledExactlyOnceWith(
      "alice.dusk",
      recordKeys
    );
  });

  it.each([
    ["only a public account", { moonlight: account }, { account }],
    ["only a shielded address", { phoenix: address }, { address }],
    [
      "a public account record that isn't a valid key",
      { moonlight: invalidKey, phoenix: address },
      { address },
    ],
    [
      "a shielded address record that is a public account",
      { moonlight: account, phoenix: account },
      { account },
    ],
    [
      "a shielded address record with whitespace around it",
      { moonlight: account, phoenix: ` ${address}\n` },
      { account },
    ],
    [
      "a shielded address record that isn't UTF-8 text",
      { moonlight: account, phoenix: [...utf8(address), 0xff] },
      { account },
    ],
  ])(
    "should take only the valid addresses of a name with %s",
    async (_, records, addresses) => {
      createLensReader.mockResolvedValue(
        readerResolving({ ...records, status: "Active" })
      );

      await expect(
        resolveDuskName("alice.dusk", "testnet", nodeUrl)
      ).resolves.toStrictEqual({ ...addresses, name: "alice.dusk" });
    }
  );

  it("should create one reader per network, from the pinned release and the wallet's node", async () => {
    createLensReader.mockResolvedValue(
      readerResolving({ moonlight: account, status: "Active" })
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
    const reader = readerResolving({ moonlight: account, status: "Active" });

    reader.resolve.mockRejectedValueOnce(
      new Error("The lens reader took over 15000 ms")
    );
    createLensReader
      .mockRejectedValueOnce(new Error("The lens driver did not load"))
      .mockResolvedValue(reader);

    for (const expected of [
      { error: "lookup-failed", name: "alice.dusk" },
      { error: "lookup-failed", name: "alice.dusk" },
      { account, name: "alice.dusk" },
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
    ["no-address", "a name without either record", { status: "Active" }],
    [
      "no-address",
      "a name whose records are neither valid",
      { moonlight: invalidKey, phoenix: "not-an-address", status: "Active" },
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
