/** This browser or device can't give what fingerprint or face unlock needs. */
class PasskeyNoPrfError extends Error {
  constructor() {
    super("This device or browser can't do fingerprint or face unlock.");
    this.name = "PasskeyNoPrfError";
  }
}

export default PasskeyNoPrfError;
