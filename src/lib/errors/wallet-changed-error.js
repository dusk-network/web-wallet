/** Something drawn for one wallet, asked to act once another opened, or after a lock. */
class WalletChangedError extends Error {
  constructor() {
    super("The wallet changed meanwhile.");
    this.name = "WalletChangedError";
  }
}

export default WalletChangedError;
