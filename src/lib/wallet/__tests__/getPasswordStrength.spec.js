import { describe, expect, it } from "vitest";

import { getPasswordStrength } from "..";

describe("getPasswordStrength", () => {
  it.each([
    "password",
    "Password123!",
    "qwertyuiop",
    "12345678",
    "aaaaaaaaaaaaaaaa",
    "mydusk2026",
    "abcdefgh",
  ])("should call %s weak", (password) => {
    expect(getPasswordStrength(password)).toBe("weak");
  });

  it.each(["kettle42ga", "sundialrain", "tulips4ever"])(
    "should call %s fair",
    (password) => {
      expect(getPasswordStrength(password)).toBe("fair");
    }
  );

  it.each(["correct horse battery", "Kettle-42-garden", "Tulp7&ZonnigWeer"])(
    "should call %s strong",
    (password) => {
      expect(getPasswordStrength(password)).toBe("strong");
    }
  );
});
