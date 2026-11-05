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
    /** With the search open, a step of its own in the history. */
    search?: boolean;
    /** How many sheets over a list this tab stepped to (sheetStep). */
    sheets?: number;
    /** At the review of a send, a step of its own in the history. */
    sendReview?: boolean;
    routeReview?: boolean;
    /** At the review of a stake, a step of its own in the history. */
    stakeReview?: boolean;
  }
}
