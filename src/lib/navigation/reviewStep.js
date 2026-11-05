import { pushState } from "$app/navigation";
import { page } from "$app/stores";
import { onDestroy } from "svelte";
import { get } from "svelte/store";

import { getErrorFrom } from "$lib/dusk/error";
import describeFailure from "$lib/transactions/describeFailure";

/**
 * A form's review as a step of its own in the browser's history: Back returns
 * to the form, with what's filled in, and Forward to the review. For a
 * component to take as it's made: once it's gone, it moves the history no more.
 *
 * @param {"sendReview" | "stakeReview"} name What the history calls it
 */
export default function reviewStep(name) {
  let isGone = false;

  const isAt = () => Boolean(get(page)?.state?.[name]);

  /** The review's place in the history goes, if it has one. */
  const leave = () => {
    if (isAt() && !isGone) {
      history.back();
    }
  };

  onDestroy(() => {
    isGone = true;
  });

  return {
    /** The history moves on to the review, unless it's there. */
    enter() {
      if (!isAt()) {
        pushState("", { [name]: true });
      }
    },

    leave,

    /**
     * What the review sent, as it ends: its place in the history goes once
     * that went out, or may have. With nothing sent, it stays, so that Back
     * from the failure returns to the form.
     *
     * @param {Promise<unknown>} operation
     * @param {() => void} [onNothingSent]
     */
    settle(operation, onNothingSent = () => {}) {
      Promise.resolve(operation).then(leave, (error) => {
        if (describeFailure(getErrorFrom(error)).canRetry) {
          onNothingSent();
        } else {
          leave();
        }
      });
    },
  };
}
