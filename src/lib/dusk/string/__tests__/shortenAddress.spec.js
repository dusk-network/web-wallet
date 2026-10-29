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

  it("should write a Dusk contract ID or hash in lower case, six characters at each end", () => {
    expect(
      shortenAddress(
        "2257E5F8FF49CF7C9704A14CA35ACBF48EB7ADE11A079D98D5CD5655EEA1B31D"
      )
    ).toBe("2257e5…a1b31d");
  });

  it("should write an EVM address as 0x and four characters with its checksum, and the last four", () => {
    expect(shortenAddress("0x75685f9d88749b583732b40d56fe007cd404b72d")).toBe(
      "0x7568…b72D"
    );
    expect(shortenAddress("0x2D2e08C0E8d64381Db56bF2c942Bc825602E61C3")).toBe(
      "0x2D2e…61C3"
    );
  });

  it("should write an EVM transaction hash as 0x and four characters, and the last four", () => {
    expect(
      shortenAddress(
        "0x029E1F00000000000000000000000000000000000000000000000000AB77D61B"
      )
    ).toBe("0x029e…d61b");
  });
});
