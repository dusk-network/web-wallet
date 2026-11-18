/**
 * Whether the device is touch alone, as a phone or a tablet is: something to
 * point with, and nothing that hovers, as a mouse or a trackpad does. There,
 * recovery words are typed masked, as a password is, and show only while
 * Hold to show words is held (holdToShow): a phone's app switcher can keep a
 * picture of whatever shows as the page is left, before the page hears of
 * it. Firefox and Chrome name a phone's pen a fine pointer, as they do a
 * mouse, but say it can't hover; a computer with a touch screen has a mouse
 * or a trackpad that can. Hover is asked as "hover" only: Chrome says "none"
 * too as soon as one thing, a touch screen, can't.
 */

import { readable } from "svelte/store";

const POINTERS = ["(any-pointer: coarse)", "(any-pointer: fine)"];
const HOVERS = "(any-hover: hover)";

/** Whether the device is touch alone now: never where that can't be said. */
function isTouchOnly() {
  if (typeof globalThis.matchMedia !== "function") {
    return false;
  }

  return (
    POINTERS.some((query) => matchMedia(query).matches) &&
    !matchMedia(HOVERS).matches
  );
}

/**
 * Whether the device is touch alone, said again as a mouse or a keyboard
 * with a trackpad comes or goes.
 *
 * @type {import("svelte/store").Readable<boolean>}
 */
export const touchOnly = readable(isTouchOnly(), (set) => {
  if (typeof globalThis.matchMedia !== "function") {
    return;
  }

  const queries = [...POINTERS, HOVERS].map((query) => matchMedia(query));
  const tell = () => set(isTouchOnly());

  tell();

  for (const query of queries) {
    query.addEventListener?.("change", tell);
  }

  return () => {
    for (const query of queries) {
      query.removeEventListener?.("change", tell);
    }
  };
});
