declare namespace svelteHTML {
  interface HTMLAttributes<T> {
    "on:wizardstepchange"?: (
      event: CustomEvent<{ step: number; stepsCount: number }>
    ) => void;
  }
}

/* Aliases for common w3sper's types */

type AccountBalance = import("@dusk/w3sper").AccountBalance;
type AccountSyncer = import("@dusk/w3sper").AccountSyncer;
type AddressBalance = import("@dusk/w3sper").AddressBalance;
type AddressSyncer = import("@dusk/w3sper").AddressSyncer;
type Bookmark = import("@dusk/w3sper").Bookmark;
type Contract = import("@dusk/w3sper").Contract;
type DataDriverRegistry = import("@dusk/w3sper").DataDriverRegistry;
type Gas = import("@dusk/w3sper").Gas;
type Network = import("@dusk/w3sper").Network;
type Profile = import("@dusk/w3sper").Profile;
type ProfileGenerator = import("@dusk/w3sper").ProfileGenerator;
type StakeInfo = import("@dusk/w3sper").StakeInfo;

declare namespace App {
  interface PageState {
    /** Send opened with the wallet's own amount, as one sent back: hidden with the balances. */
    amountHidden?: boolean;
    /** The unlock after the wallet locked itself: the minutes it was left alone. */
    lockedAfter?: number;
    /** With the network's panel open, a step of its own in the history. */
    networkPanel?: boolean;
    /** With the profile menu open, a step of its own in the history. */
    profileMenu?: boolean;
    /** With the search open, a step of its own in the history. */
    search?: boolean;
    /** The places this tab stepped from to the sheets over a list (sheetStep). */
    sheets?: string[];
    /** At the review of a send, a step of its own in the history. */
    sendReview?: boolean;
    /** Send opened to send a payment back, filled in from it, not from a link. */
    sendBack?: boolean;
    routeReview?: boolean;
    /** At the review of a stake, a step of its own in the history. */
    stakeReview?: boolean;
  }
}
