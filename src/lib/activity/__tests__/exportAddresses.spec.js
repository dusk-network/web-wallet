import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { get } from "svelte/store";

import {
  addExportAddress,
  exportAddresses,
  hydrateExportAddresses,
  removeExportAddress,
} from "../exportAddresses";

const KEY = `${CONFIG.LOCAL_STORAGE_APP_KEY}-export-evm`;
const ONE = "0x90fe2f14bbdd4bbb68ad0ce1a7b6c1b4d6bf4b39";
const TWO = "0xB4721c9fd9e4aB5E5a3b2b3cDe1f2a4B6c7d3685";

describe("The EVM addresses added to a profile's export", () => {
  beforeEach(() => {
    localStorage.removeItem(KEY);
    hydrateExportAddresses();
  });

  afterEach(() => {
    localStorage.removeItem(KEY);
    hydrateExportAddresses();
  });

  it("should keep each for its profile once, in any letter case, and read them back as the wallet opens again", () => {
    addExportAddress("profile-1", ONE);
    addExportAddress("profile-1", ONE.toUpperCase().replace("0X", "0x"));
    addExportAddress("profile-1", TWO);
    addExportAddress("profile-2", TWO);

    expect(get(exportAddresses)).toStrictEqual({
      "profile-1": [ONE, TWO],
      "profile-2": [TWO],
    });
    expect(hydrateExportAddresses()).toStrictEqual({
      "profile-1": [ONE, TWO],
      "profile-2": [TWO],
    });
  });

  it("should keep nothing that isn't an EVM address, nor one for no profile, and read none kept wrong", () => {
    addExportAddress("profile-1", "0x90fe");
    addExportAddress("", ONE);
    localStorage.setItem(
      KEY,
      JSON.stringify({ "profile-1": ["not one", 7], "profile-2": "0x1" })
    );

    expect(hydrateExportAddresses()).toStrictEqual({});
  });

  it("should take one off its profile, and leave the others", () => {
    addExportAddress("profile-1", ONE);
    addExportAddress("profile-1", TWO);
    addExportAddress("profile-2", ONE);
    removeExportAddress("profile-1", ONE.toUpperCase().replace("0X", "0x"));

    expect(hydrateExportAddresses()).toStrictEqual({
      "profile-1": [TWO],
      "profile-2": [ONE],
    });

    removeExportAddress("profile-1", TWO);

    expect(hydrateExportAddresses()).toStrictEqual({ "profile-2": [ONE] });
  });
});
