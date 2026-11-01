import { goto as svelteGoto } from "$app/navigation";

import addBasePath from "./addBasePath";

/** @type {(...args: Parameters<svelteGoto>) => ReturnType<svelteGoto>} */
const goto = (url, ...rest) =>
  // eslint-disable-next-line svelte/no-navigation-without-resolve -- addBasePath adds the base path
  svelteGoto(addBasePath(url), ...rest);

export default goto;
