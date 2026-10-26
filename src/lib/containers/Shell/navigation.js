import { base } from "$app/paths";
import { mdiHistory, mdiHomeOutline, mdiLayersOutline } from "@mdi/js";

/**
 * @typedef {{ href: string, icon: string, id: string, label: string }} ShellTab
 */

/**
 * The wallet's pages, as the top bar and the phone's tab bar show them.
 * History and Staking are there when they are on.
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
 * Whether a network is a test network, whose DUSK has no value: any known
 * network but mainnet.
 *
 * @param {string} name
 */
export const isTestNetwork = (name) =>
  Boolean(name) && name !== "unknown" && name !== "mainnet";
