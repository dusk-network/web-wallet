import { describe, expect, it } from "vitest";

import { shortenAddress } from "..";

describe("shortenAddress", () => {
  it("should keep the first and last six characters of an address around an ellipsis", () => {
    const address =
      "2in5ncLyGWg1CaQnPgkyMRaxrEtMmTKZXBy6yZxBeg5BL7ifxf2ZwT1h4VPsJYe8BpPMWYsHmNJGrXhJ1fMMLNz";

    expect(shortenAddress(address)).toBe("2in5nc…fMMLNz");
  });

  it("should leave an address of twelve characters or fewer as it is", () => {
    expect(shortenAddress("")).toBe("");
    expect(shortenAddress("2in5nc")).toBe("2in5nc");
    expect(shortenAddress("2in5ncfMMLNz")).toBe("2in5ncfMMLNz");
  });
});
