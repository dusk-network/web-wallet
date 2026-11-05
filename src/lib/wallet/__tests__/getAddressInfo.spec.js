import { decodeBase58, encodeBase58 } from "@dusk-network/networks/account";
import { describe, expect, it } from "vitest";

import { getAddressInfo } from "..";

describe("getAddressInfo", () => {
  describe("a shielded address", () => {
    // As the wallet core made it, from a seed.
    const address =
      "2opnVd3huLf8EKpG7R993ss1zWXrLeArGLupA3wrXG99Y1EU8aCcYjUD5utnz8eYn8Jg8Fa8oVNqq52XNrc3i8Nd";

    /** @param {number[]} bytes */
    const encoded = (bytes) => encodeBase58(Uint8Array.from(bytes));

    it("should take one that's two keys, and say whose it is", () => {
      expect(getAddressInfo(address, "", "")).toMatchObject({
        isSelfReferential: false,
        isValid: true,
        type: "address",
      });
      expect(getAddressInfo(address, address, "")).toMatchObject({
        isSelfReferential: true,
        isValid: true,
      });
    });

    it("should refuse what only has an address's length", () => {
      for (const fill of [0x07, 0x63, 0xff, 0x00]) {
        expect(
          getAddressInfo(encoded(new Array(64).fill(fill)), "", "").isValid
        ).toBe(false);
      }
    });

    it("should refuse one with a character changed", () => {
      for (const at of [0, 20, 44, 70, address.length - 1]) {
        const other = address[at] === "2" ? "3" : "2";

        expect(
          getAddressInfo(
            address.slice(0, at) + other + address.slice(at + 1),
            "",
            ""
          ).isValid
        ).toBe(false);
      }
    });

    it("should refuse a key that's the curve's neutral point, which nobody could spend from", () => {
      const neutral = [1, ...new Array(31).fill(0)];

      expect(
        getAddressInfo(encoded([...neutral, ...neutral]), "", "").isValid
      ).toBe(false);

      const [, ...second] = Array.from(
        /** @type {Uint8Array} */ (decodeBase58(address))
      );

      expect(
        getAddressInfo(encoded([...neutral, ...second.slice(31)]), "", "")
          .isValid
      ).toBe(false);
    });
  });

  it("should refuse a public account with one character changed, or its last dropped", () => {
    const account =
      "21SvzTdXggQkZpnkwvWi8CC3Mn5FsSRenW5NfkL2wmjLMwEmY4K27Vs2DUaEzWQ3aRLZE3U1dgX5UY2zsWG4HTHaRyA7tKUe6ubrqYZBxFuWB4FzvgP4tEL1cH5wFRKVGARR";

    for (const at of [
      0,
      1,
      30,
      60,
      90,
      account.length - 2,
      account.length - 1,
    ]) {
      const other = account[at] === "2" ? "3" : "2";
      const mistyped = account.slice(0, at) + other + account.slice(at + 1);

      expect(getAddressInfo(mistyped, "", "").isValid).toBe(false);
    }

    expect(getAddressInfo(account.slice(0, -1), "", "").isValid).toBe(false);
    expect(getAddressInfo(account, "", "")).toMatchObject({
      isValid: true,
      type: "account",
    });
  });

  const validShieldedAddresses = [
    "47jNTgAhzn9KCKF3msCfvKg3k1P1QpPCLZ3HG3AoNp87sQ5WNS3QyjckYHWeuXqW7uvLmbKgejpP8Xkcip89vnMM",
    "4ozNeBzeQq5XZGoMYTBKfSG9pmPBa4UWxbfHV3BSDtgeMMz2Xw8oZgVAhN16yC94CUQkg7iAe8fpQT4CsF41iKy6",
  ];

  // Provisioners' accounts, from the network.
  const validPublicAddresses = [
    "2131Xe28JCogeQqgK4VTjtDwY5GJ5oFSUQgQobAiFbUKcXK2BzpJdoj4iGammHGgkbnbykjqPVWmy3S83TDgqfPmtLgBv56ZzeuhHbuFy9bCerhU4JTwEi2oCxxPKSx5983T",
    "21KL9R1h2CWF4Su1RGkf6MucN92yUKMRKgBE4gns9mV1r8BW46APhvBBVX4Ut7f5Zxf639KTZUb2zanB4UZiYsEJkzkwoNJ1GQuKKPBNQkUGKwKq5iudjQJ2UiQFHZ71rMvN",
  ];

  const invalidInputs = [
    // Invalid Base58
    "InvalidKey12345",

    // Too short
    "4LaS4bWzFQtvxZ7frUaXbfm3xsbnHHYwNkGnLqqpmWPY",

    // Too long
    "5kB6VBePF8eFhFVjLwM1xrEL6yGBm1uDsoWyRjdqDQ2nNz8nECAsRh3MZiM6uEo6WmukqyKzzCK9B5rcPTnjZQgtXXXXXXXX",

    // Empty string
    "",

    // Contains an invalid character (!)
    "4ozNeBzeQq5XZGoMYTBKfSG9pmPBa4UWxbfHV3BSDtgeMMz2Xw8oZgVAhN16yC94CUQkg7iAe8fpQT4CsF41iKy6!",

    // Contains an invalid character (_)
    "47jNTgAhzn9_CKF3msCfvKg3k1P1QpPCLZ3HG3AoNp87sQ5WNS3QyjckYHWeuXqW7uvLmbKgejpP8Xkcip89vnM",

    // Contains an invalid character ( )
    "47jNTgAhzn9 CKF3msCfvKg3k1P1QpPCLZ3HG3AoNp87sQ5WNS3QyjckYHWeuXqW7uvLmbKgejpP8Xkcip89vnM",

    // Contains an invalid character (0)
    "47jNTgAhzn0KCKF3msCfvKg3k1P1QpPCLZ3HG3AoNp87sQ5WNS3QyjckYHWeuXqW7uvLmbKgejpP8Xkcip89vnMM",

    // Contains an invalid character (O)
    "47jNTgAhznOKCKF3msCfvKg3k1P1QpPCLZ3HG3AoNp87sQ5WNS3QyjckYHWeuXqW7uvLmbKgejpP8Xkcip89vnMM",

    // Contains an invalid character (l)
    "47jNTgAhznlKCKF3msCfvKg3k1P1QpPCLZ3HG3AoNp87sQ5WNS3QyjckYHWeuXqW7uvLmbKgejpP8Xkcip89vnMM",

    // Contains an invalid character (I)
    "47jNTgAhznIKCKF3msCfvKg3k1P1QpPCLZ3HG3AoNp87sQ5WNS3QyjckYHWeuXqW7uvLmbKgejpP8Xkcip89vnMM",
  ];

  // Shielded and public addresses for self-referential checks
  const shieldedAddress =
    "47jNTgAhzn9KCKF3msCfvKg3k1P1QpPCLZ3HG3AoNp87sQ5WNS3QyjckYHWeuXqW7uvLmbKgejpP8Xkcip89vnMM";
  const publicAddress =
    "zTsZq814KfWUAQujzjBchbMEvqA1FiKBUakMCtAc2zCa74h9YVz4a2roYwS7LHDHeBwS1aap4f3GYhQBrxroYgsBcE4FJdkUbvpSD5LVXY6JRXNgMXgk6ckTPJUFKoHybff";

  it("passes with valid shielded addresses and checks self-referential status", () => {
    for (const address of validShieldedAddresses) {
      const result = getAddressInfo(address, shieldedAddress, publicAddress);

      // Valid address should pass validation
      expect(result.isValid).toBe(true);

      // Type should be "address"
      expect(result.type).toBe("address");

      // Check if the address matches the shielded address
      expect(result.isSelfReferential).toBe(address === shieldedAddress);
    }
  });

  it("passes with valid public addresses and checks self-referential status", () => {
    for (const account of validPublicAddresses) {
      const result = getAddressInfo(account, shieldedAddress, publicAddress);

      // Valid account should pass validation
      expect(result.isValid).toBe(true);

      // Type should be "account"
      expect(result.type).toBe("account");

      // Check if the account matches the public address
      expect(result.isSelfReferential).toBe(account === publicAddress);
    }
  });

  it("fails when supplied with an invalid input", () => {
    for (const input of invalidInputs) {
      const result = getAddressInfo(input, shieldedAddress, publicAddress);

      // Invalid inputs should fail validation
      expect(result.isValid).toBe(false);

      // Self-referential check should not apply to invalid inputs
      expect(result.isSelfReferential).toBeUndefined();
    }
  });
});
