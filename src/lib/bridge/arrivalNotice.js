/**
 * Says when a transfer ends to whoever isn't looking at the wallet: in the
 * tab's title always, and by a browser notification once they chose that. The
 * browser is asked only when they press for it, never as a page opens, and a
 * phone's browser can't notify from a page: the title says it there.
 */

import { base } from "$app/paths";
import { derived, get, writable } from "svelte/store";

const KEY = `${CONFIG.LOCAL_STORAGE_APP_KEY}-arrival-notice`;

/** What's said for each state but "offer", which offers it. */
export const NOTICE_WORDS = Object.freeze({
  on: "You'll get a notification when it arrives.",
  refused:
    "Notifications aren't allowed for this site, so this tab's title will say when it arrives.",
  unavailable: "This tab's title will say when it arrives.",
});

/** A phone's browser can't notify from a page. */
const isPhone = () =>
  Boolean(
    globalThis.matchMedia?.("(pointer: coarse) and (hover: none)").matches ||
    /Android|iPhone|iPad|Mobile/u.test(navigator.userAgent)
  );

const api = () => (isPhone() ? null : (globalThis.Notification ?? null));

const wanted = () => {
  try {
    return localStorage.getItem(KEY) === "on";
  } catch {
    return false;
  }
};

const looking = () =>
  document.visibilityState === "visible" && document.hasFocus();

/** Whether the browser refused, since this page opened. */
const refused = writable(false);

/** What the tab's title says first: "" for its own. */
const title = writable("");

/** Bumped as they choose or stop, for the state to be asked again. */
const chosen = writable(0);

/**
 * "offer" until they chose, then "on" or "refused"; "unavailable" where a page
 * can't notify.
 *
 * @type {import("svelte/store").Readable<"offer" | "on" | "refused" | "unavailable">}
 */
export const arrivalNoticeState = derived([refused, chosen], ([$refused]) => {
  const notifications = api();

  if (!notifications) {
    return "unavailable";
  }

  return wanted() && notifications.permission === "granted"
    ? "on"
    : $refused
      ? "refused"
      : "offer";
});

/** What the tab's title says first, while they're away from what ended. */
export const arrivalTitle = { subscribe: title.subscribe };

/**
 * Whether a transfer is followed with the page hidden: once they asked to be
 * told, or where the title is the one way to be.
 */
export const followsWhileAway = () => get(arrivalNoticeState) !== "offer";

/** They pressed for it: the browser is asked, if it hasn't been answered yet. */
export async function chooseArrivalNotice() {
  const notifications = api();

  if (!notifications) {
    return;
  }

  const answer =
    (await notifications.requestPermission()) ?? notifications.permission;

  refused.set(answer !== "granted");

  if (answer === "granted") {
    try {
      localStorage.setItem(KEY, "on");
    } catch {
      // The title still says it.
    }
  }

  chosen.update((n) => n + 1);
}

/** They turned it off. */
export function stopArrivalNotice() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Nothing is kept where storage can't be read.
  }

  refused.set(false);
  chosen.update((n) => n + 1);
}

/**
 * A transfer ended. Whoever is looking at the page sees it there.
 *
 * @param {{ id: string, onOpen?: () => void, title: string }} ended
 */
export function transferEnded({ id, onOpen = () => {}, title: said }) {
  if (looking()) {
    return;
  }

  title.set(said);

  if (get(arrivalNoticeState) !== "on") {
    return;
  }

  try {
    const notice = new /** @type {typeof Notification} */ (api())(said, {
      icon: `${base}/favicon.png`,
      tag: id,
    });

    notice.onclick = () => {
      globalThis.focus?.();
      onOpen();
      notice.close?.();
    };
  } catch {
    // Some browsers notify only through a service worker: the title says it.
  }
}

/** They're back: the title is the tab's own again. */
export function arrivalSeen() {
  if (looking()) {
    title.set("");
  }
}

/** The wallet locked: nothing's said of it any more. */
export const forgetArrivalTitle = () => title.set("");
