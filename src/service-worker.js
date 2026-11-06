/**
 * The wallet's service worker, registered only once someone asks to be told
 * when a transfer arrives: a phone's browser shows a notification only from
 * one. It handles a notification's click alone, bringing the wallet's page to
 * the front at what arrived, or opening it there. No page or file goes
 * through it, and it keeps nothing.
 */

/**
 * The worker's own scope, as a page's types can't name it.
 *
 * @type {any}
 */
const worker = globalThis;

worker.addEventListener("install", () => worker.skipWaiting());

worker.addEventListener("activate", (/** @type {any} */ event) =>
  event.waitUntil(worker.clients.claim())
);

worker.addEventListener("notificationclick", (/** @type {any} */ event) => {
  const { scope } = worker.registration;
  const asked = String(event.notification.data?.url ?? "");
  const url = new URL(asked || scope, scope);

  event.notification.close();

  // Only the wallet's own pages: what a notification names is one.
  const open = url.href.startsWith(scope) ? url.href : scope;

  event.waitUntil(
    worker.clients
      .matchAll({ includeUncontrolled: true, type: "window" })
      .then((/** @type {any[]} */ windows) => {
        const wallet = windows.find((client) =>
          String(client.url).startsWith(scope)
        );

        if (!wallet) {
          return worker.clients.openWindow(open);
        }

        wallet.postMessage({ type: "arrival-open", url: open });

        return wallet.focus();
      })
  );
});
