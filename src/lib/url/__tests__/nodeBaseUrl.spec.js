import { describe, expect, it, vi } from "vitest";

// makeNodeUrl as a built page has it: an empty node URL resolves against
// the URL of the module that builds it, a chunk under /assets.
vi.mock("../makeNodeUrl", () => ({
  default: (path = "") =>
    new URL(path, "https://wallet.example/assets/makeNodeUrl-a1b2c3.js"),
}));

describe("nodeBaseUrl, as a built page has it", () => {
  it("should give the page's origin for an empty node URL, never the module's URL", async () => {
    const { nodeBaseUrl } = await import("..");

    expect(nodeBaseUrl()).toBe("https://wallet.example");
  });
});
