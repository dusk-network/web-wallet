import { get } from "svelte/store";

import { redirect } from "$lib/navigation";
import { walletStore } from "$lib/stores";

/** @type {import("./$types").LayoutLoad} */
export async function load() {
  if (import.meta.env.VITE_MODE_MAINTENANCE === "true") {
    redirect(307, "/maintenance");
  }

  // Back from the wallet to what came before it: it's open.
  if (get(walletStore).initialized) {
    redirect(307, "/dashboard");
  }
}
