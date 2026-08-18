import { afterEach, describe, expect, it } from "vitest";

import loginInfoStorage from "$lib/services/loginInfoStorage";

import encryptBuffer from "../encryptBuffer";
import generateMnemonic from "../generateMnemonic";
import migrateLoginInfo from "../migrateLoginInfo";

describe("migrateLoginInfo", () => {
  afterEach(() => {
    loginInfoStorage.remove();
  });

  it("should preserve legacy login info if migration fails", async () => {
    const legacyLoginInfo = await encryptBuffer(
      new TextEncoder().encode(generateMnemonic()),
      "some password",
      10_000
    );

    loginInfoStorage.set(legacyLoginInfo);

    await expect(
      migrateLoginInfo(legacyLoginInfo, "wrong password")
    ).rejects.toThrow();

    const storedLoginInfo = loginInfoStorage.get();

    expect(storedLoginInfo).not.toBeNull();

    if (!storedLoginInfo) {
      throw new Error("Expected stored login info");
    }

    for (const field of /** @type {const} */ (["data", "iv", "salt"])) {
      expect([...storedLoginInfo[field]]).toStrictEqual([
        ...legacyLoginInfo[field],
      ]);
    }
    expect(storedLoginInfo.version).toBeUndefined();
  });
});
