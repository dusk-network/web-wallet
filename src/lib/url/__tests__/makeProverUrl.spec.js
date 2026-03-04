import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeProverUrl } from "..";

const protocol = "https://";

beforeEach(async () => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("makeProverUrl", () => {
  const localhostString = window.location.hostname;

  it("should return a local URL when VITE_PROVER_URL is not set", () => {
    vi.stubEnv("VITE_PROVER_URL", "");
    expect(makeProverUrl().hostname).toBe(localhostString);
  });

  it("should return a local URL path when VITE_PROVER_URL is not set and a path is provided", () => {
    vi.stubEnv("VITE_PROVER_URL", "");
    expect(makeProverUrl("/on/prover/prove").hostname).toBe(localhostString);
    expect(makeProverUrl("/on/prover/prove").pathname).toBe("/on/prover/prove");
  });

  it("should return the devnet prover URL when the hostname starts with 'apps.staging.devnet'", () => {
    const hostname = "apps.staging.devnet.dusk.network";
    vi.stubGlobal("location", { hostname, protocol });
    expect(makeProverUrl().hostname).toBe("devnet.provers.dusk.network");
  });

  it("should return the devnet prover URL when the hostname starts with 'apps.devnet'", () => {
    const hostname = "apps.devnet.dusk.network";
    vi.stubGlobal("location", { hostname, protocol });
    expect(makeProverUrl().hostname).toBe("devnet.provers.dusk.network");
  });

  it("should return the testnet prover URL when the hostname starts with 'apps.staging.testnet'", () => {
    const hostname = "apps.staging.testnet.dusk.network";
    vi.stubGlobal("location", { hostname, protocol });
    expect(makeProverUrl().hostname).toBe("testnet.provers.dusk.network");
  });

  it("should return the testnet prover URL when the hostname starts with 'apps.testnet'", () => {
    const hostname = "apps.testnet.dusk.network";
    vi.stubGlobal("location", { hostname, protocol });
    expect(makeProverUrl().hostname).toBe("testnet.provers.dusk.network");
  });

  it("should return the mainnet prover URL when the hostname starts with 'apps.staging'", () => {
    const hostname = "apps.staging.dusk.network";
    vi.stubGlobal("location", { hostname, protocol });
    expect(makeProverUrl().hostname).toBe("provers.dusk.network");
  });

  it("should return the mainnet prover URL when the hostname starts with 'apps'", () => {
    const hostname = "apps.dusk.network";
    vi.stubGlobal("location", { hostname, protocol });
    expect(makeProverUrl().hostname).toBe("provers.dusk.network");
  });

  it("should use VITE_PROVER_URL on custom hostnames", () => {
    const hostname = "my.custom.domain";
    vi.stubGlobal("location", { hostname, protocol });
    vi.stubEnv("VITE_PROVER_URL", "https://example-prover.network");

    expect(makeProverUrl().hostname).toBe("example-prover.network");
  });
});
