import { describe, expect, it } from "vitest";

import { bytesToBase64 } from "..";

describe("bytesToBase64", () => {
  const source = Uint8Array.of(1, 1, 2, 3, 5, 8, 13, 21);

  it("should convert a Uint8Array to a base 64 string", () => {
    expect(bytesToBase64(source)).toBe("AQECAwUIDRU=");
  });

  it("should convert one larger than a call takes as arguments", () => {
    const large = new Uint8Array(300_000).fill(65);

    expect(bytesToBase64(large)).toBe("QUFB".repeat(100_000));
  });
});
