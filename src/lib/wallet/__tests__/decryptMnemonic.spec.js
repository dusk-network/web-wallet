import { describe, expect, it } from "vitest";

import {
  decryptMnemonic,
  encryptBuffer,
  encryptMnemonic,
  generateMnemonic,
} from "..";

describe("decryptMnemonic", () => {
  const mnemonic = generateMnemonic();
  const pwd = "some password";

  it("should be able to decrypt the mnemonic phrase using the given password", async () => {
    const mnemonicEncryptInfo = await encryptMnemonic(mnemonic, pwd);
    const decrypted = await decryptMnemonic(mnemonicEncryptInfo, pwd);

    expect(decrypted).toBe(mnemonic);
  });

  it("should decrypt legacy, unversioned mnemonic data", async () => {
    const mnemonicEncryptInfo = await encryptBuffer(
      new TextEncoder().encode(mnemonic),
      pwd,
      10_000
    );
    const decrypted = await decryptMnemonic(mnemonicEncryptInfo, pwd);

    expect(decrypted).toBe(mnemonic);
  });

  it("should reject unsupported encryption versions", async () => {
    const mnemonicEncryptInfo = await encryptMnemonic(mnemonic, pwd);

    await expect(
      decryptMnemonic({ ...mnemonicEncryptInfo, version: 2 }, pwd)
    ).rejects.toThrow("Unsupported wallet encryption version");
  });
});
