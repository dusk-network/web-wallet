import { afterEach, describe, expect, it, vi } from "vitest";

import loginInfoStorage from "$lib/services/loginInfoStorage";

import encryptBuffer from "../encryptBuffer";
import generateMnemonic from "../generateMnemonic";
import migrateLoginInfo from "../migrateLoginInfo";

describe("migrateLoginInfo", () => {
  afterEach(() => loginInfoStorage.remove());

  it("should not restore login info when a pending migration is cancelled", async () => {
    const legacyLoginInfo = await encryptBuffer(
      new TextEncoder().encode(generateMnemonic()),
      "some password",
      10_000
    );
    await loginInfoStorage.set(legacyLoginInfo);
    const controller = new AbortController();
    const migration = migrateLoginInfo(
      legacyLoginInfo,
      "some password",
      controller.signal
    );
    controller.abort();
    await Promise.all([
      expect(migration).rejects.toMatchObject({ name: "AbortError" }),
      loginInfoStorage.remove(),
    ]);
    expect(loginInfoStorage.get()).toBeNull();
  });

  it.each(["remove", "replace"])(
    "should preserve a cross-tab %s before cancellation is delivered",
    async (change) => {
      const legacyLoginInfo = await encryptBuffer(
        new TextEncoder().encode(generateMnemonic()),
        "some password",
        10_000
      );
      await loginInfoStorage.set(legacyLoginInfo);
      const encrypted = Promise.withResolvers();
      const resume = Promise.withResolvers();
      const encrypt = crypto.subtle.encrypt.bind(crypto.subtle);
      const encryptSpy = vi
        .spyOn(crypto.subtle, "encrypt")
        .mockImplementationOnce(async (...args) => {
          const result = await encrypt(...args);
          encrypted.resolve(undefined);
          await resume.promise;
          return result;
        });
      const controller = new AbortController();
      const migration = migrateLoginInfo(
        legacyLoginInfo,
        "some password",
        controller.signal
      );

      try {
        await encrypted.promise;
        if (change === "remove") {
          await loginInfoStorage.remove();
        } else {
          await loginInfoStorage.set({ ...legacyLoginInfo, version: 1 });
        }
        const key = `${CONFIG.LOCAL_STORAGE_APP_KEY}-login`;
        const expected = localStorage.getItem(key);
        resume.resolve(undefined);
        expect(controller.signal.aborted).toBe(false);
        await expect(migration).resolves.toBe(false);
        controller.abort();
        expect(localStorage.getItem(key)).toBe(expected);
      } finally {
        resume.resolve(undefined);
        await migration.catch(() => {});
        encryptSpy.mockRestore();
      }
    }
  );

  it("should preserve legacy login info if migration fails", async () => {
    const legacyLoginInfo = await encryptBuffer(
      new TextEncoder().encode(generateMnemonic()),
      "some password",
      10_000
    );

    await loginInfoStorage.set(legacyLoginInfo);

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
