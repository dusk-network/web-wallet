/**
 * The wallet's Content-Security-Policy, as its build settings make it: only
 * its own scripts, with SvelteKit's inline ones by their hashes (kit.csp,
 * svelte.config.js), WebAssembly, and the addresses it reads from, which
 * are its network's and the services its pages use. Every page carries it,
 * and Cloudflare sends it as a header (deploy/stage.js).
 */

import { networks } from "@dusk-network/networks";

/** DUSK's prices: Home's value, and the export's and rewards' euros. */
const PRICES = ["https://api.coingecko.com"];

/**
 * WalletConnect and Reown, as AppKit connects an EVM wallet: its config and
 * wallet list, its RPC and relay, and its verify frame. Their wallets'
 * pictures and AppKit's fonts come from there too.
 */
const REOWN = {
  connect: [
    "https://api.web3modal.org",
    "https://pulse.walletconnect.org",
    "https://rpc.walletconnect.org",
    "https://verify.walletconnect.com",
    "https://verify.walletconnect.org",
    "wss://relay.walletconnect.com",
    "wss://relay.walletconnect.org",
  ],
  font: ["https://fonts.reown.com"],
  frame: [
    "https://verify.walletconnect.com",
    "https://verify.walletconnect.org",
  ],
  img: ["https://api.web3modal.org"],
};

/**
 * An address's origin: the WebSocket one too for a node, whose events come
 * that way. Nothing for what isn't an http(s) address, as a path.
 *
 * @param {string | null | undefined} address
 * @param {{ socket?: boolean }} [options]
 * @returns {string[]}
 */
function originsOf(address, { socket = false } = {}) {
  const url = URL.parse(address ?? "");

  if (!url || !["http:", "https:"].includes(url.protocol)) {
    return [];
  }

  return socket
    ? [url.origin, `${url.protocol === "https:" ? "wss" : "ws"}://${url.host}`]
    : [url.origin];
}

/**
 * The addresses a network's file gives the wallet to read from: its node,
 * archive and prover, Dusk Domains' manifest, DuskEVM's RPCs and explorer
 * API, and each route's chain's RPC.
 *
 * @param {import("@dusk-network/networks").Network} net
 * @returns {string[]}
 */
const networkOrigins = (net) => [
  ...originsOf(net.urls.node, { socket: true }),
  ...originsOf(net.urls.archive),
  ...originsOf(net.urls.prover),
  ...originsOf(/** @type {any} */ (net).duskDomains?.manifest?.url),
  ...originsOf(/** @type {any} */ (net).duskEvm?.rpcUrl),
  ...originsOf(/** @type {any} */ (net).duskEvm?.l1AdapterUrl),
  ...originsOf(/** @type {any} */ (net).duskEvm?.blockscoutApiUrl),
  ...Object.values(/** @type {any} */ (net).routes?.chains ?? {}).flatMap(
    (chain) => originsOf(/** @type {any} */ (chain)?.rpcUrl)
  ),
];

/**
 * The networks a build can find itself on: the one whose node it's built
 * with, or every one, as a build for a node of its own (VITE_NODE_URL not a
 * network's) can be on any.
 *
 * @param {string | undefined} nodeUrl
 */
function networksOf(nodeUrl) {
  const node = URL.parse(nodeUrl ?? "")?.origin;
  const all = Object.values(networks);
  const its = all.filter(
    (net) => node && URL.parse(net.urls.node)?.origin === node
  );

  return its.length ? its : all;
}

/**
 * The policy's directives for a build's settings, as kit.csp takes them:
 * keywords unquoted, SvelteKit quotes them and adds the hashes of its own
 * inline scripts.
 *
 * @param {Record<string, string | undefined>} settings Its VITE_ settings
 * @returns {Record<string, string[]>}
 */
export function cspDirectives(settings) {
  const connect = new Set([
    "self",
    ...networksOf(settings.VITE_NODE_URL).flatMap(networkOrigins),
    ...originsOf(settings.VITE_NODE_URL, { socket: true }),
    ...[
      settings.VITE_EVM_BRIDGE_RPC_URL,
      settings.VITE_EVM_L1_BRIDGE_RPC_URL,
      settings.VITE_EVM_BRIDGE_BLOCK_EXPLORER_URL,
      settings.VITE_BRIDGE_CONTRACT_DATA_DRIVER_URL,
      settings.VITE_EVM_OPTIMISM_PORTAL_DATA_DRIVER_URL,
      settings.VITE_EVM_DISPUTE_GAME_FACTORY_DATA_DRIVER_URL,
      settings.VITE_EVM_ANCHOR_STATE_REGISTRY_DATA_DRIVER_URL,
    ].flatMap((address) => originsOf(address)),
    ...PRICES,
    ...REOWN.connect,
  ]);

  return {
    "base-uri": ["self"],
    "connect-src": [...connect],
    "default-src": ["self"],
    "font-src": ["self", ...REOWN.font],
    "form-action": ["self"],
    "frame-ancestors": ["none"],
    "frame-src": REOWN.frame,
    "img-src": ["self", "data:", "blob:", ...REOWN.img],
    "manifest-src": ["self"],
    "object-src": ["none"],
    "script-src": ["self", "wasm-unsafe-eval"],
    // Svelte's transitions and AppKit's own elements set styles inline.
    "style-src": ["self", "unsafe-inline"],
    // w3sper starts its WebAssembly in a worker made from its own code, as
    // a blob: only the wallet's scripts can make one.
    "worker-src": ["self", "blob:"],
  };
}
