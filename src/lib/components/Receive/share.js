/**
 * Sharing through the phone's share sheet, where the browser has one: most
 * phones, some computers. A request goes as text alone, a line saying what
 * it asks, then its link: some targets would add a separate link twice.
 */

import { mdiAlertOutline } from "@mdi/js";

import { toast } from "$lib/dusk/components/Toast/store";

/** Whether the browser has a share sheet. */
export const canShare = () =>
  typeof navigator !== "undefined" && typeof navigator.share === "function";

/**
 * Shares text through the share sheet: true once it went, false where the
 * sheet was closed, or it failed, which is said.
 *
 * @param {{ text: string, title: string }} shared
 * @returns {Promise<boolean>}
 */
export async function shareText(shared) {
  try {
    await navigator.share(shared);

    return true;
  } catch (error) {
    // Closing the sheet is an answer, not a failure.
    if (error instanceof Error && error.name !== "AbortError") {
      toast("error", "Couldn't share that", mdiAlertOutline);
    }

    return false;
  }
}
