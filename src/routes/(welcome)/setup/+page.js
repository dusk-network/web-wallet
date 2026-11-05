import { redirect } from "$lib/navigation";
import vault from "$lib/vault";

/**
 * With fingerprint or face unlock on, straight to it, past the chooser: which
 * the unlock's Back still leads to.
 *
 * @type {import("./$types").PageLoad}
 */
export function load({ url }) {
  if (vault.passkey() && !url.searchParams.has("choose")) {
    redirect(307, "/unlock");
  }
}
