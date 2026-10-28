import { beforeEach, describe, expect, it, vi } from "vitest";
import { activityNetworkKey } from "$lib/activity/activityHistory";

import { makeNodeUrl, nodeBaseUrl } from "..";

const protocol = "https://";

beforeEach(async () => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("makeNodeUrl", () => {
  const localhostString = window.location.hostname;

  it("should return a local URL when VITE_NODE_URL is not set", () => {
    vi.stubEnv("VITE_NODE_URL", "");
    expect(makeNodeUrl().hostname).toBe(localhostString);
  });

  it("should return a local URL with no base path when VITE_NODE_URL is not set and VITE_RUSK_PATH is not set", () => {
    vi.stubEnv("VITE_NODE_URL", "");
    vi.stubEnv("VITE_RUSK_PATH", "");
    expect(makeNodeUrl().hostname).toBe(localhostString);
    expect(makeNodeUrl().pathname).toBe("/");
  });

  it("should return a local URL with a base path when `VITE_NODE_URL` is not set and `VITE_RUSK_PATH` is set to a valid string", () => {
    vi.stubEnv("VITE_NODE_URL", "");
    vi.stubEnv("VITE_RUSK_PATH", "/testing");
    expect(makeNodeUrl().hostname).toBe(localhostString);
    expect(makeNodeUrl().pathname).toBe("/testing");
  });

  it("should return the devnet URL when the hostname starts with 'apps.staging.devnet'", () => {
    const hostname = "apps.staging.devnet.dusk.network";
    vi.stubGlobal("location", { hostname, protocol });
    expect(makeNodeUrl().hostname).toBe("devnet.nodes.dusk.network");
  });

  it("should return the devnet URL when the hostname starts with 'apps.devnet'", () => {
    const hostname = "apps.devnet.dusk.network";
    vi.stubGlobal("location", { hostname, protocol });
    expect(makeNodeUrl().hostname).toBe("devnet.nodes.dusk.network");
  });

  it("should return the testnet URL when the hostname starts with 'apps.staging.testnet'", () => {
    const hostname = "apps.staging.testnet.dusk.network";
    vi.stubGlobal("location", { hostname, protocol });
    expect(makeNodeUrl().hostname).toBe("testnet.nodes.dusk.network");
  });

  it("should return the testnet URL when the hostname starts with 'apps.testnet'", () => {
    const hostname = "apps.testnet.dusk.network";
    vi.stubGlobal("location", { hostname, protocol });
    expect(makeNodeUrl().hostname).toBe("testnet.nodes.dusk.network");
  });

  it("should return the mainnet URL when the hostname starts with 'apps.staging'", () => {
    const hostname = "apps.staging.dusk.network";
    vi.stubGlobal("location", { hostname, protocol });
    expect(makeNodeUrl().hostname).toBe("nodes.dusk.network");
  });

  it("should return the mainnet URL when the hostname starts with 'apps'", () => {
    const hostname = "apps.dusk.network";
    vi.stubGlobal("location", { hostname, protocol });
    expect(makeNodeUrl().hostname).toBe("nodes.dusk.network");
  });
});

describe("nodeBaseUrl", () => {
  const origin = window.location.origin;

  it.each([
    ["no node URL or path: the page's origin", "", "", origin],
    ["a Rusk path", "", "/rusk", `${origin}/rusk`],
    ["a Rusk path with a slash after it", "", "rusk/", `${origin}/rusk`],
    ["a node URL", "https://node.example", "", "https://node.example"],
    [
      "a node URL with a path",
      "https://node.example/rusk/",
      "",
      "https://node.example/rusk",
    ],
    [
      "a node URL and a Rusk path",
      "https://node.example/",
      "rusk",
      "https://node.example/rusk",
    ],
  ])("should keep %s, without a trailing slash", (_, url, path, base) => {
    vi.stubEnv("VITE_NODE_URL", url);
    vi.stubEnv("VITE_RUSK_PATH", path);

    expect(nodeBaseUrl()).toBe(base);
  });

  it.each([
    ["apps.testnet.dusk.network", "", "https://testnet.nodes.dusk.network"],
    [
      "apps.testnet.dusk.network",
      "/rusk",
      "https://testnet.nodes.dusk.network/rusk",
    ],
    ["apps.dusk.network", "", "https://nodes.dusk.network"],
  ])(
    "should keep the hosted node of %s, with the Rusk path %s",
    (hostname, path, base) => {
      vi.stubGlobal("location", { hostname, protocol });
      vi.stubEnv("VITE_RUSK_PATH", path);

      expect(nodeBaseUrl()).toBe(base);
    }
  );

  it("should key the history by the base it gives", () => {
    vi.stubEnv("VITE_NODE_URL", "");
    vi.stubEnv("VITE_RUSK_PATH", "");

    expect(activityNetworkKey(nodeBaseUrl())).toBe(origin);

    vi.stubEnv("VITE_RUSK_PATH", "/rusk");

    expect(activityNetworkKey(nodeBaseUrl())).toBe(`${origin}/rusk`);

    vi.stubGlobal("location", {
      hostname: "apps.testnet.dusk.network",
      protocol,
    });

    expect(activityNetworkKey(nodeBaseUrl())).toBe("testnet");
  });
});
