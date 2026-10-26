/**
 * Words that make a password easy to guess wherever they are in it.
 */
const GUESSABLE_PARTS = [
  "123456",
  "654321",
  "abc123",
  "admin",
  "dusk",
  "iloveyou",
  "letmein",
  "passw0rd",
  "password",
  "qwerty",
  "welcome",
  "wallet",
];

const CHARACTER_KINDS = [/[a-z]/, /[A-Z]/, /\d/, /[^a-zA-Z\d]/];

/**
 * A rough idea of how hard a password is to guess, to hint at while it is
 * typed: "weak" when it holds a common password or a run of one character,
 * "strong" from 14 characters, or 10 with three kinds of characters, and
 * "fair" otherwise.
 *
 * @param {string} password
 * @returns {"fair" | "strong" | "weak"}
 */
export default function getPasswordStrength(password) {
  const lowerCase = password.toLowerCase();
  const kinds = CHARACTER_KINDS.filter((kind) => kind.test(password)).length;

  if (
    password.length < 8 ||
    /^(.)\1*$/.test(password) ||
    GUESSABLE_PARTS.some((part) => lowerCase.includes(part)) ||
    (password.length < 10 && kinds < 2)
  ) {
    return "weak";
  }

  return password.length >= 14 || (password.length >= 10 && kinds >= 3)
    ? "strong"
    : "fair";
}
