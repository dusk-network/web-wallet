import { afterEach, describe, expect, it, vi } from "vitest";

import { namehashHex } from "@duskdomains/sdk";
import { networks } from "@dusk-network/networks";

import releases from "$lib/dusk-domains/dusk-domains-releases.json";
import { SOZU_POOLS } from "$lib/sozu/config";

import {
  DUSK_DOMAINS_CONTRACTS,
  contractLabel,
  isNameRegistration,
  knownCall,
  nameCommitOf,
  registeredNameOf,
} from "../knownContracts";

import { calls as REGISTRATIONS } from "./fixtures/registrations-testnet.json";

const STORE =
  "4e2de1ed4f1fd53de83f4809a75367301c7645a546030fa199aff804e6854199";

describe("knownCall", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("should know Dusk Domains' contracts as its release names them", () => {
    for (const network of /** @type {const} */ (["mainnet", "testnet"])) {
      const release = releases[network];

      expect([...DUSK_DOMAINS_CONTRACTS[network]].sort()).toStrictEqual(
        [...release.contracts.map((c) => c.contractId), release.lens.contractId]
          .map((id) => id.toLowerCase().replace(/^0x/, ""))
          .sort()
      );
    }
  });

  it("should say what a call to Dusk Domains did, on its network only", () => {
    expect(
      knownCall({ contractId: STORE, fnName: "register" }, "testnet")
    ).toEqual({
      app: "Dusk Domains",
      label: "Registered a .dusk name",
    });
    expect(knownCall({ contractId: `0x${STORE}`, fnName: "commit" })).toEqual({
      app: "Dusk Domains",
      label: "Name reservation (step 1 of 2)",
    });
    expect(
      knownCall({ contractId: STORE, fnName: "other" }, "testnet")
    ).toEqual({
      app: "Dusk Domains",
      label: "Dusk Domains",
    });
    expect(
      knownCall({ contractId: STORE, fnName: "register" }, "mainnet")
    ).toBeNull();
    expect(
      knownCall({ contractId: STORE, fnName: "register" }, "devnet")
    ).toBeNull();
    expect(
      knownCall({ contractId: "ab".repeat(32), fnName: "register" })
    ).toBeNull();
  });

  it("should say which name a reservation was for, once its registration revealed it", () => {
    expect(
      knownCall(
        { contractId: STORE, fnName: "commit", reservedName: "alice.dusk" },
        "testnet"
      )
    ).toEqual({ app: "Dusk Domains", label: "Reserved alice.dusk" });
    // Only a reservation's.
    expect(
      knownCall(
        { contractId: STORE, fnName: "renew", reservedName: "alice.dusk" },
        "testnet"
      )?.label
    ).toBe("Renewed a .dusk name");
  });

  it("should say which name a registration registered, once that's read", () => {
    expect(
      knownCall(
        { contractId: STORE, fnName: "register", registeredName: "alice.dusk" },
        "testnet"
      )
    ).toEqual({ app: "Dusk Domains", label: "Registered alice.dusk" });
    // Not read, or not readable: as before.
    for (const registeredName of [undefined, null]) {
      expect(
        knownCall(
          { contractId: STORE, fnName: "register", registeredName },
          "testnet"
        )?.label
      ).toBe("Registered a .dusk name");
    }
  });

  it("should name the contracts the wallet knows, as their network's file does", () => {
    const portal = networks.testnet.duskEvm?.contracts.optimism_portal;

    expect(contractLabel(STORE, "testnet")).toBe("Dusk Domains");
    expect(contractLabel(portal?.contractId, "testnet")).toBe(
      "DuskEVM bridge portal"
    );
    expect(contractLabel(networks.mainnet.sozu?.hub, "mainnet")).toBe(
      "Sozu hub"
    );
    expect(contractLabel([...SOZU_POOLS][0])).toBe("Sozu pool");
    expect(contractLabel("ab".repeat(32))).toBe("");
    expect(contractLabel("")).toBe("");

    // The bridge's contracts set for local work.
    vi.stubEnv("VITE_BRIDGE_CONTRACT_ID", "cd".repeat(32));
    vi.stubEnv("VITE_EVM_OPTIMISM_PORTAL_CONTRACT_ID", "ef".repeat(32));

    expect(contractLabel(`0x${"CD".repeat(32)}`)).toBe("DuskEVM bridge");
    expect(contractLabel("ef".repeat(32))).toBe("DuskEVM bridge");
  });
});

describe("registeredNameOf", () => {
  /** @param {string} hex */
  const bytesOf = (hex) =>
    Uint8Array.from(hex.match(/../g) ?? [], (b) => parseInt(b, 16));

  /** @param {Uint8Array} bytes */
  const hexOf = (bytes) =>
    Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

  it.each(REGISTRATIONS.map((call) => [call.name, call]))(
    "should read %s from its registration on testnet",
    (name, call) => {
      expect(isNameRegistration(call)).toBe(true);
      expect(registeredNameOf(call)).toBe(name);

      // The name read is the one the call's node was made from, as the
      // contract checks: the node starts the arguments' last 304 bytes.
      const args = bytesOf(call.data);

      expect(hexOf(args.subarray(args.length - 304, args.length - 272))).toBe(
        namehashHex(name)
      );
    }
  );

  it("should read a short name kept in place and a long one kept before the root", () => {
    const [short, long] = REGISTRATIONS;

    // "alice" is 5 bytes: in place, its length in the last byte.
    expect(short.name).toBe("alice.dusk");
    expect(bytesOf(short.data).at(-304 + 32 + 7)).toBe(5);
    // "alice-shop" is 10: out of place, the top bit of that byte set.
    expect(long.name).toBe("alice-shop.dusk");
    expect(bytesOf(long.data).at(-304 + 32 + 7)).toBeGreaterThanOrEqual(0x80);
  });

  it("should leave other calls alone, and read nothing from arguments that don't read exactly", () => {
    const [short, long] = REGISTRATIONS;
    const args = bytesOf(long.data);
    const root = args.length - 304;

    /** @param {(bytes: Uint8Array) => void} change */
    const changed = (change) => {
      const copy = args.slice();

      change(copy);

      return { ...long, data: hexOf(copy) };
    };

    expect(registeredNameOf({ ...long, fnName: "renew" })).toBeUndefined();
    expect(
      registeredNameOf({ ...long, contractId: "ab".repeat(32) })
    ).toBeUndefined();
    expect(isNameRegistration({ ...long, fnName: "commit" })).toBe(false);

    for (const call of [
      // Not hex, or cut short.
      { ...long, data: "" },
      { ...long, data: "xyz" },
      { ...long, data: long.data.slice(0, -2) },
      { ...long, data: long.data.slice(2) },
      // Its label pointing past the root, or before the arguments.
      changed((bytes) =>
        new DataView(bytes.buffer).setInt32(root + 36, 4, true)
      ),
      changed((bytes) =>
        new DataView(bytes.buffer).setInt32(root + 36, -root - 64, true)
      ),
      // A label in capitals, or with a space.
      changed((bytes) => bytes.set([0x41], 0)),
      changed((bytes) => bytes.set([0x20], 3)),
    ]) {
      expect(registeredNameOf(call)).toBeNull();
    }

    // Kept in place, but longer than the place holds.
    const tooLong = bytesOf(short.data);

    tooLong[tooLong.length - 304 + 32 + 7] = 8;
    expect(registeredNameOf({ ...short, data: hexOf(tooLong) })).toBeNull();
  });
});

describe("nameCommitOf", () => {
  it("should read what a registration on testnet reveals of its reservation", () => {
    for (const call of REGISTRATIONS) {
      const root = call.data.slice(-608);

      expect(nameCommitOf(call)).toStrictEqual({
        commitment: root.slice(82, 146),
        node: namehashHex(call.name),
        secret: root.slice(146, 210),
      });
    }
  });

  it("should read a reservation's commitment, its 32 bytes and nothing else", () => {
    const commitment = "c0".repeat(32);

    expect(
      nameCommitOf({ contractId: STORE, data: commitment, fnName: "commit" })
    ).toStrictEqual({ commitment });

    for (const data of ["c0".repeat(31), "c0".repeat(33), "", "xyz"]) {
      expect(
        nameCommitOf({ contractId: STORE, data, fnName: "commit" })
      ).toBeNull();
    }

    expect(
      nameCommitOf({
        contractId: STORE,
        data: REGISTRATIONS[0].data.slice(2),
        fnName: "register",
      })
    ).toBeNull();
  });

  it("should read nothing of other calls, or of other contracts' calls", () => {
    const [alice] = REGISTRATIONS;

    expect(nameCommitOf({ ...alice, fnName: "renew" })).toBeUndefined();
    expect(
      nameCommitOf({ ...alice, contractId: "ab".repeat(32) })
    ).toBeUndefined();
  });
});
