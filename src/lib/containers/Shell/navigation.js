import { base } from "$app/paths";
import { asksPayment } from "$lib/payment-requests/asked";
import {
  mdiContactsOutline,
  mdiHistory,
  mdiHomeOutline,
  mdiLayersOutline,
} from "@mdi/js";

/**
 * @typedef {{ href: string, icon: string, id: string, label: string }} ShellTab
 */

/**
 * The wallet's pages, as the top bar and the phone's tab bar show them.
 * History and Staking are there when they are on; Contacts always is.
 *
 * @param {{ history?: boolean, stake: boolean }} features
 * @returns {ShellTab[]}
 */
export function shellTabs({ history = true, stake }) {
  return [
    { href: "/dashboard", icon: mdiHomeOutline, id: "home", label: "Home" },
    ...(history
      ? [
          {
            href: "/dashboard/transactions",
            icon: mdiHistory,
            id: "history",
            label: "History",
          },
        ]
      : []),
    ...(stake
      ? [
          {
            href: "/dashboard/stake",
            icon: mdiLayersOutline,
            id: "staking",
            label: "Staking",
          },
        ]
      : []),
    {
      href: "/dashboard/contacts",
      icon: mdiContactsOutline,
      id: "contacts",
      label: "Contacts",
    },
  ];
}

/**
 * A path without the app's base path, and without a trailing slash.
 *
 * @param {string} pathname
 */
export function appPath(pathname) {
  const path =
    base && pathname.startsWith(base) ? pathname.slice(base.length) : pathname;

  return path.replace(/\/+$/, "") || "/";
}

/** The pages' names, for their titles and headings. */
const PAGE_NAMES = new Map([
  ["/dashboard", "Home"],
  ["/dashboard/allocate", "Shield"],
  ["/dashboard/bridge", "Bridge"],
  ["/dashboard/bridge/transactions", "Bridge activity"],
  ["/dashboard/contacts", "Contacts"],
  ["/dashboard/receive", "Receive"],
  ["/dashboard/send", "Send"],
  ["/dashboard/stake", "Staking"],
  ["/dashboard/transactions", "History"],
  ["/settings", "Settings"],
  ["/settings/password", "Change password"],
  ["/settings/remove-wallet", "Remove wallet"],
  ["/wallets/add", "Add wallet"],
]);

/**
 * A page's name, as its title says it, or "" for one without, as the
 * welcome pages.
 *
 * @param {string} pathname
 */
export const pageName = (pathname) => PAGE_NAMES.get(appPath(pathname)) ?? "";

/** The pages that show a payment request a link asked for before a wallet opens. */
const ASKING_PAGES = new Set(["/setup", "/unlock"]);

/**
 * A tab's title: "Payment request" on a page that shows one before a wallet
 * opens, also while it connects, so it's told apart from the wallet's own
 * tabs; else the page's name with the wallet's, or the wallet's alone.
 *
 * @param {string} pathname
 * @param {string | null} place The page kept for the unlock (`peekPlace`)
 */
export function tabTitle(pathname, place) {
  if (ASKING_PAGES.has(appPath(pathname)) && asksPayment(place)) {
    return "Payment request";
  }

  const name = pageName(pathname);

  return name ? `${name} · Dusk Wallet` : "Dusk Wallet";
}

/**
 * The tab a path is on, or null for a flow, as Send or Settings.
 *
 * @param {ShellTab[]} tabs
 * @param {string} pathname
 * @returns {string | null}
 */
export function tabOf(tabs, pathname) {
  const path = appPath(pathname);

  return tabs.find((tab) => tab.href === path)?.id ?? null;
}

/**
 * A network's name as the wallet shows it, or "Connecting" until it is
 * known.
 *
 * @param {string} name
 */
export const networkLabel = (name) =>
  name && name !== "unknown"
    ? `${name.charAt(0).toUpperCase()}${name.slice(1)}`
    : "Connecting";

/**
 * The network a page is on: the one the node names, or until it does, as
 * on a page that can't reach it, the one it named last in this browser.
 *
 * @param {{ lastNetworkName?: string, networkName: string }} network
 */
export const shownNetwork = ({ lastNetworkName, networkName }) =>
  networkName && networkName !== "unknown"
    ? networkName
    : (lastNetworkName ?? "unknown");

/**
 * Whether a network is a test network, whose DUSK has no value: any known
 * network but mainnet.
 *
 * @param {string} name
 */
export const isTestNetwork = (name) =>
  Boolean(name) && name !== "unknown" && name !== "mainnet";
