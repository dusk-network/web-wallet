/**
 * Says when a transfer ends to whoever isn't looking at the wallet: in the
 * tab's title always, and by a browser notification once they chose that. The
 * browser is asked only when they press for it, never as a page opens. A
 * notification comes from the wallet's service worker, registered then, as a
 * phone's browser notifies only from one; from the page where there's none, as
 * on a computer. There's no push server: it's the open page that finds a
 * transfer ended, so nothing comes once the tab is closed, and the offer says
 * so. A phone's browser without one, as an iPhone's, can't notify at all, nor
 * shows a tab's title: the screen that shows the transfer says it there.
 */

import { dev } from "$app/environment";
import { base } from "$app/paths";
import { derived, get, writable } from "svelte/store";

const KEY = `${CONFIG.LOCAL_STORAGE_APP_KEY}-arrival-notice`;

/** What's said for each state, after the offer's button in "offer". */
export const NOTICE_WORDS = Object.freeze({
  offer: "while this tab stays open",
  on: "You'll get a notification when it arrives, while this tab stays open.",
  phone: "This screen says when it arrives.",
  refused:
    "Notifications aren't allowed for this site, so this tab's title will say when it arrives.",
  unavailable: "This tab's title will say when it arrives.",
});

/** A phone shows no tab's title. */
const isPhone = () =>
  Boolean(
    globalThis.matchMedia?.("(pointer: coarse) and (hover: none)").matches ||
    /Android|iPhone|iPad|Mobile/u.test(navigator.userAgent)
  );

/** Whether the browser notifies from a service worker, as a phone's can only. */
const hasWorker = () =>
  "serviceWorker" in navigator &&
  typeof globalThis.ServiceWorkerRegistration === "function" &&
  "showNotification" in globalThis.ServiceWorkerRegistration.prototype;

/**
 * The browser's notifications, where it can give one: through a service
 * worker, or from the page on a computer. None on a phone without one.
 */
const api = () =>
  globalThis.Notification && (hasWorker() || !isPhone())
    ? globalThis.Notification
    : null;

/**
 * What's said of each state on this device: on a phone, no tab's title.
 *
 * @param {"offer" | "on" | "phone" | "refused" | "unavailable"} state
 */
export const noticeWords = (state) =>
  state === "refused" && isPhone()
    ? "Notifications aren't allowed for this site, so this screen says when it arrives."
    : NOTICE_WORDS[state];

/** @type {Promise<ServiceWorkerRegistration | null> | null} */
let registering = null;

/**
 * The service worker the notifications come from, registered once they're
 * asked for: null where the browser has none, or it couldn't be.
 *
 * @returns {Promise<ServiceWorkerRegistration | null>}
 */
function worker() {
  if (!hasWorker()) {
    return Promise.resolve(null);
  }

  registering ??= navigator.serviceWorker
    .register(`${base}/service-worker.js`, {
      scope: `${base}/`,
      type: dev ? "module" : "classic",
    })
    .then(() => navigator.serviceWorker.ready)
    .catch(() => {
      registering = null;

      return null;
    });

  return registering;
}

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
 * "offer" until they chose, then "on" or "refused"; "phone" on a phone that
 * can't notify, and "unavailable" on a computer that can't.
 *
 * @type {import("svelte/store").Readable<"offer" | "on" | "phone" | "refused" | "unavailable">}
 */
export const arrivalNoticeState = derived([refused, chosen], ([$refused]) => {
  const notifications = api();

  if (!notifications) {
    return isPhone() ? "phone" : "unavailable";
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
    // Its worker, ready for the first: registering it can take a moment.
    void worker();

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
 * Notifies of what ended: through the service worker, which brings the wallet
 * to `href` as it's pressed, or else from the page.
 *
 * @param {{ href: string, id: string, onOpen: () => void, said: string }} ended
 */
async function notify({ href, id, onOpen, said }) {
  const icon = `${base}/favicon.png`;
  const registration = await worker();

  if (registration) {
    await registration.showNotification(said, {
      data: { url: `${location.origin}${base}${href}` },
      icon,
      tag: id,
    });

    return;
  }

  const notice = new /** @type {typeof Notification} */ (api())(said, {
    icon,
    tag: id,
  });

  notice.onclick = () => {
    globalThis.focus?.();
    onOpen();
    notice.close?.();
  };
}

/**
 * A transfer ended. Whoever is looking at the page sees it there.
 *
 * @param {{ href?: string, id: string, onOpen?: () => void, title: string }} ended
 *   `href` the page of the wallet that shows it, without the base path
 */
export function transferEnded({
  href = "/dashboard",
  id,
  onOpen = () => {},
  title: said,
}) {
  if (looking()) {
    return;
  }

  title.set(said);

  if (get(arrivalNoticeState) !== "on") {
    return;
  }

  try {
    // A browser that won't notify leaves the title to say it.
    notify({ href, id, onOpen, said }).catch(() => {});
  } catch {
    // The title says it.
  }
}

/**
 * Where a notification pressed brings the wallet: the page it names, as its
 * service worker asks, while the wallet is open here.
 *
 * @param {(href: string) => unknown} open Goes to a page, without the base path
 * @returns {() => void} Stops
 */
export function followNotificationClicks(open) {
  if (!hasWorker()) {
    return () => {};
  }

  /** @param {MessageEvent} event */
  const handle = ({ data }) => {
    if (data?.type !== "arrival-open" || typeof data.url !== "string") {
      return;
    }

    const url = new URL(data.url, location.href);
    const path = url.pathname.startsWith(`${base}/`)
      ? url.pathname.slice(base.length)
      : null;

    if (url.origin === location.origin && path) {
      open(`${path}${url.search}`);
    }
  };

  // What it was added to is what it's taken off.
  const worker = navigator.serviceWorker;

  worker.addEventListener("message", handle);

  return () => worker.removeEventListener("message", handle);
}

/** They're back: the title is the tab's own again. */
export function arrivalSeen() {
  if (looking()) {
    title.set("");
  }
}

/** The wallet locked: nothing's said of it any more. */
export const forgetArrivalTitle = () => title.set("");
