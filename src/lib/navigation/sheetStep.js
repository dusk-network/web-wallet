import { page } from "$app/stores";
import { get } from "svelte/store";

import addBasePath from "./addBasePath";
import goto from "./goto";

/**
 * An address, to tell if two are the same place: its trailing slash and the
 * order of its query don't count.
 *
 * @param {string} href With the base path
 */
function placeOf(href) {
  const url = new URL(href, location.origin);

  url.searchParams.sort();

  return `${url.pathname.replace(/\/+$/, "")}?${url.searchParams}`;
}

/**
 * Moves between a list and the sheets over it, as History's details or a
 * contact's, with each sheet a step of its own in the browser's history: Back
 * closes the top one and leaves the list as it was, and a sheet's own close
 * does the same. Closing takes the steps back only to the place asked for, as
 * this tab stepped there: anything else, as another contact from a contact's
 * form, or a sheet this tab didn't step to, as from a link, is that place, in
 * place of the one it's leaving.
 *
 * @param {string} href Where it goes, for the address: its query says what's open
 * @param {number} from How many sheets are open now
 * @param {number} to How many will be
 */
export default function sheetStep(href, from, to) {
  const { state, url } = get(page);
  const behind = state?.sheets ?? [];
  const options = { keepFocus: true, noScroll: true };

  if (to > from) {
    return goto(href, {
      ...options,
      state: { sheets: [...behind, placeOf(`${url.pathname}${url.search}`)] },
    });
  }

  if (to < from) {
    const place = behind.lastIndexOf(placeOf(addBasePath(href)));

    if (place >= 0) {
      history.go(place - behind.length);

      return Promise.resolve();
    }
  }

  return goto(href, {
    ...options,
    replaceState: true,
    state: { sheets: behind },
  });
}
