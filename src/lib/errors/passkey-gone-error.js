/** Fingerprint or face unlock isn't on any more, or opens nothing: the password does. */
class PasskeyGoneError extends Error {
  constructor() {
    super("Fingerprint or face unlock is off. Use your password.");
    this.name = "PasskeyGoneError";
  }
}

export default PasskeyGoneError;
