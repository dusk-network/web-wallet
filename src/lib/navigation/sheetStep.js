import { page } from "$app/stores";
import { get } from "svelte/store";

import goto from "./goto";

/**
 * Moves between a list and the sheets over it, as History's details or a
 * contact's, with each sheet a step of its own in the browser's history: Back
 * closes the top one and leaves the list as it was, and a sheet's own close
 * does the same. A sheet this tab didn't step to, as from a link, closes in
 * place.
 *
 * @param {string} href Where it goes, for the address: its query says what's open
 * @param {number} from How many sheets are open now
 * @param {number} to How many will be
 */
export default function sheetStep(href, from, to) {
  const stepped = get(page)?.state?.sheets ?? 0;
  const options = { keepFocus: true, noScroll: true };

  if (to > from) {
    return goto(href, { ...options, state: { sheets: stepped + to - from } });
  }

  if (to < from && stepped >= from - to) {
    history.go(to - from);

    return Promise.resolve();
  }

  return goto(href, {
    ...options,
    replaceState: true,
    state: { sheets: stepped },
  });
}
