/** The password a big send asks for wasn't given: nothing was sent. */
class SendPasswordDeclinedError extends Error {
  constructor() {
    super("The password wasn't given.");
    this.name = "SendPasswordDeclinedError";
  }
}

export default SendPasswordDeclinedError;
