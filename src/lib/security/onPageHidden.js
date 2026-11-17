/**
 * Calls `hide` the moment the page is hidden, or about to be: the window
 * loses the focus, the page goes to the background, or it's left. Where the
 * window's blur comes first, while the page still shows, what `hide`
 * changes is painted before the browser takes its picture of the page; a
 * picture taken before any of them, as Firefox for Android's app switcher
 * and tab list can, still shows the page as it was.
 *
 * @param {() => void} hide
 * @returns {() => void} What stops it
 */
export default function onPageHidden(hide) {
  const onVisibility = () => {
    if (document.visibilityState === "hidden") {
      hide();
    }
  };

  window.addEventListener("blur", hide);
  window.addEventListener("pagehide", hide);
  document.addEventListener("visibilitychange", onVisibility);

  return () => {
    window.removeEventListener("blur", hide);
    window.removeEventListener("pagehide", hide);
    document.removeEventListener("visibilitychange", onVisibility);
  };
}
