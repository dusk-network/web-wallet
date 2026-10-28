import { describe, expect, it } from "vitest";

import { closeDuskName, editDistance } from "..";

describe("editDistance", () => {
  it("counts letters added, removed or changed, and a swap of neighbours as one", () => {
    expect(editDistance("alice", "alice")).toBe(0);
    expect(editDistance("alice", "alise")).toBe(1);
    expect(editDistance("alice", "alcie")).toBe(1);
    expect(editDistance("alice", "alic")).toBe(1);
    expect(editDistance("alice", "bob")).toBe(5);
  });
});

describe("closeDuskName", () => {
  const known = ["alice.dusk", "alice-shop.dusk", "bram.dusk"];

  it("suggests the closest known name one or two edits away", () => {
    expect(closeDuskName("alise.dusk", known)).toBe("alice.dusk");
    expect(closeDuskName("ALCIE.dusk", known)).toBe("alice.dusk");
    expect(closeDuskName("alice-shpo.dusk", known)).toBe("alice-shop.dusk");
  });

  it("allows one edit for short names, and suggests nothing far off or the same", () => {
    expect(closeDuskName("bran.dusk", known)).toBe("bram.dusk");
    expect(closeDuskName("brxx.dusk", known)).toBeNull();
    expect(closeDuskName("charlie.dusk", known)).toBeNull();
    expect(closeDuskName("alice.dusk", known)).toBeNull();
    expect(closeDuskName("", known)).toBeNull();
  });
});
