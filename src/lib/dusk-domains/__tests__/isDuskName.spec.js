import { describe, expect, it } from "vitest";

import { isDuskName } from "..";

describe("isDuskName", () => {
  it("should take input ending in .dusk as a name, whatever its case and surrounding whitespace", () => {
    for (const input of [
      "alice.dusk",
      "pay.alice.dusk",
      " Alice.DUSK\n",
      "bad_name.dusk",
    ]) {
      expect(isDuskName(input)).toBe(true);
    }
  });

  it("should leave addresses and any other input to the address checks", () => {
    for (const input of [
      "",
      "dusk",
      "alicedusk",
      "alice.duskx",
      "alice.dusk.network",
      "zTsZq814KfWUAQujzjBchbMEvqA1FiKBUakMCtAc2zCa74h9YVz4a2roYwS7LHDHeBwS1aap4f3GYhQBrxroYgsBcE4FJdkUbvpSD5LVXY6JRXNgMXgk6ckTPJUFKoHybff",
      "47jNTgAhzn9KCKF3msCfvKg3k1P1QpPCLZ3HG3AoNp87sQ5WNS3QyjckYHWeuXqW7uvLmbKgejpP8Xkcip89vnMM",
    ]) {
      expect(isDuskName(input)).toBe(false);
    }
  });
});
