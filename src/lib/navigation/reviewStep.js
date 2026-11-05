import { pushState } from "$app/navigation";
import { page } from "$app/stores";
import { get } from "svelte/store";

/**
 * A form's review as a step of its own in the browser's history: Back returns
 * to the form, with what's filled in, and Forward to the review.
 *
 * @param {"sendReview" | "stakeReview"} name What the history calls it
 */
export default function reviewStep(name) {
  const isAt = () => Boolean(get(page)?.state?.[name]);

  return {
    /** Whether the history is at the review. */
    isAt,

    /** The history moves on to the review, unless it's there. */
    enter() {
      if (!isAt()) {
        pushState("", { [name]: true });
      }
    },

    /** The review's place in the history goes, if it has one. */
    leave() {
      if (isAt()) {
        history.back();
      }
    },
  };
}
