import { describe, expect, it } from "vitest";

import { asDuskName } from "..";

describe("asDuskName", () => {
  it("should take a name typed without .dusk, or with a dot after it, for its .dusk name", () => {
    expect(asDuskName("alice")).toBe("alice.dusk");
    expect(asDuskName(" Alice \n")).toBe("alice.dusk");
    expect(asDuskName("alice.dusk.")).toBe("alice.dusk");
    expect(asDuskName("alice.")).toBe("alice.dusk");
    expect(asDuskName("pay.alice")).toBe("pay.alice.dusk");
    expect(asDuskName("wallet-both")).toBe("wallet-both.dusk");
    expect(asDuskName("ALICE.DUSK.")).toBe(null);
  });

  it("should take nothing that can't be a name, as an address", () => {
    for (const input of [
      "",
      ".",
      "dusk",
      "-alice",
      "alice-",
      "bad_name",
      "a.b.c.d.e",
      "x".repeat(64),
      "0x19e7e376e7c213b7e7e7e46cc70a5dd086daff2a",
      "0x19E7E376E7C213B7E7e7e46cc70A5dD086DAff2A",
      "zTsZq814KfWUAQujzjBchbMEvqA1FiKBUakMCtAc2zCa74h9YVz4a2roYwS7LHDHeBwS1aap4f3GYhQBrxroYgsBcE4FJdkUbvpSD5LVXY6JRXNgMXgk6ckTPJUFKoHybff",
      "47jNTgAhzn9KCKF3msCfvKg3k1P1QpPCLZ3HG3AoNp87sQ5WNS3QyjckYHWeuXqW7uvLmbKgejpP8Xkcip89vnMM",
      "47jNTgAhzn9KCKF3ms",
    ]) {
      expect(asDuskName(input)).toBeNull();
    }
  });
});
