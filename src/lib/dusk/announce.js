/** The app's one polite live region, made on first use. */
/** @type {HTMLElement | null} */
let region = null;

let saying = 0;
let clearing = 0;

/**
 * Says `words` to screen readers, once, from the app's one polite live
 * region, and clears it after `forMs`.
 *
 * @param {string} words
 * @param {number} forMs
 */
export function announce(words, forMs) {
  if (!region?.isConnected) {
    region = document.createElement("div");
    region.className = "sr-only";
    region.setAttribute("aria-live", "polite");
    document.body.append(region);
  }

  const live = region;

  clearTimeout(saying);
  clearTimeout(clearing);
  live.textContent = "";
  // A moment after the region is there and empty, so it's heard.
  saying = window.setTimeout(() => {
    live.textContent = words;
  }, 50);
  clearing = window.setTimeout(() => {
    live.textContent = "";
  }, 50 + forMs);
}
