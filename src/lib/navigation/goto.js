import { goto as svelteGoto } from "$app/navigation";

import addBasePath from "./addBasePath";

/**
 * The navigation asked last through `goto` while it goes, and what it was
 * asked with: for one held up as it goes (Leave this payment?), to go on as
 * it was asked, in its page's place in the browser's history too where it
 * replaced it. None once it ended.
 *
 * @type {{ href: string, options: Parameters<typeof svelteGoto>[1] } | null}
 */
let going = null;

/**
 * What the navigation to `href` (absolute) was asked with, while it goes:
 * undefined for one not asked through `goto`, or that ended.
 *
 * @param {string} href
 * @returns {Parameters<typeof svelteGoto>[1]}
 */
export const askedWith = (href) =>
  going?.href === href ? going.options : undefined;

/** @type {(...args: Parameters<svelteGoto>) => ReturnType<svelteGoto>} */
const goto = (url, ...rest) => {
  const path = addBasePath(url);
  const asked = { href: new URL(path, location.href).href, options: rest[0] };

  going = asked;

  // eslint-disable-next-line svelte/no-navigation-without-resolve -- addBasePath adds the base path
  return svelteGoto(path, ...rest).finally(() => {
    if (going === asked) {
      going = null;
    }
  });
};

export default goto;
