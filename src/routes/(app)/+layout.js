import { keepPlace, redirect } from "$lib/navigation";
import { get } from "svelte/store";

import { walletStore } from "$lib/stores";

/** @type {import("./$types").LayoutLoad} */
export async function load({ untrack, url }) {
  if (import.meta.env.VITE_MODE_MAINTENANCE === "true") {
    redirect(307, "/maintenance");
  }
  if (!get(walletStore).initialized) {
    // A reload locks, and a link comes before any unlock: the unlock returns
    // to the page asked for, with what it says in its query.
    keepPlace(untrack(() => url));
    redirect(307, "/");
  }
}
