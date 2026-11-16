/**
 * Asking for a payment and paying what's asked, by a link
 * (`@dusk-network/app-core/payment-links`): what a link asks of Send, as it's
 * pasted, scanned or opened, and the requests this wallet made, kept on this
 * device.
 */

import { base } from "$app/paths";
import {
  LINK_SEVERAL,
  LINK_UNCLEAR,
  chainLabel,
  linkAmount,
  makePaymentLink,
  parsePaymentLink,
  readPastedLink as readPasted,
  readPaymentLink as readLink,
  requestMessage,
} from "@dusk-network/app-core/payment-links";
import { networkFor } from "@dusk-network/networks";
import { isDuskName } from "@duskdomains/sdk/names";

import { isValidEvmAddress } from "$lib/dusk/string";
import getAddressInfo from "$lib/wallet/getAddressInfo";

export { matchRequests } from "@dusk-network/app-core/requests";
export {
  forgetRequest,
  forgetWalletRequests,
  hydrateRequests,
  keepRequestMatches,
  paidAtOf,
  rememberRequest,
  requestsStore,
} from "./requests";

export { REQUEST_FIELDS, asksPayment } from "./asked";

/**
 * This web wallet's own address: its Send is read on any network, and links
 * are made for it where the network's file names no web wallet.
 */
export const ownWalletUrl = () => `${location.origin}${base}`;

/** What's said of a link whose recipient is no address, as one cut short. */
export const LINK_BAD_ADDRESS =
  "This link's address isn't valid. Ask for a new one.";

/**
 * Whether a link's recipient is no Dusk address, as one cut short on its way:
 * a `.dusk` name or an EVM address, which Send says more of, aside.
 *
 * @param {string} to
 */
export const isBrokenAddress = (to) =>
  !isDuskName(to) &&
  !isValidEvmAddress(to) &&
  !getAddressInfo(to, "", "").isValid;

/**
 * The same request on the web wallet of the network it's for, for a link
 * that's for another network than this wallet's: null where that network
 * has none, or the link asks for nothing that can be paid.
 *
 * @param {string} text
 * @returns {{ href: string, network: string } | null}
 */
export function elsewhereLink(text) {
  const link = parsePaymentLink(text.trim(), { walletUrl: ownWalletUrl() });
  const net = link?.chainId ? networkFor(link.chainId) : null;

  if (!link || !net?.apps?.wallet) {
    return null;
  }

  const { https } = makePaymentLink({
    amountLux: link.lux,
    label: link.label || null,
    memo: link.memo || null,
    network: net,
    to: link.to,
  });

  if (!https) {
    return null;
  }

  // An amount that could be either of two, as 1.000, as the link writes it:
  // that wallet's Send asks which, as this one does, never settled here.
  const href = new URL(https);

  if (linkAmount(link).problem) {
    href.searchParams.set("amount", link.amountDusk);
  }

  return { href: href.href, network: chainLabel(link.chainId) };
}

/**
 * The page a link opened, in Firefox, where a phone's browser that isn't
 * hands it over: Android's intent for it, which opens Firefox's store page
 * where it isn't installed.
 *
 * @param {string} href
 */
export function inFirefox(href) {
  const { host, pathname, protocol, search } = new URL(href);

  return `intent://${host}${pathname}${search}#Intent;scheme=${protocol.slice(0, -1)};package=org.mozilla.firefox;end`;
}

/**
 * What a link asks of Send, as it's pasted, scanned or opened.
 *
 * @typedef {{ amount: string, elsewhere?: null, memo: string, problem: "", to: string }
 *   | { amount: "", elsewhere?: { href: string, network: string } | null, memo: "", problem: string, to: "" }} LinkAsked
 *   `problem` says why it fills in nothing: it can't be read, it says two
 *   amounts, its address isn't one, or it's for another network, whose web
 *   wallet takes it (`elsewhere`)
 */

/**
 * What a link app-core read asks of Send: what to fill in, or why it fills
 * in nothing, with the same request on the network's own web wallet where
 * it's for another network (`elsewhere`, from the link as it's written,
 * `text`).
 *
 * @param {import("@dusk-network/app-core/payment-links").LinkRead | import("@dusk-network/app-core/payment-links").PastedLinkRead} read
 * @param {string} text
 * @param {string} [language] The language the amount field reads
 * @returns {LinkAsked}
 */
function askedOf(read, text, language) {
  // Said as the link's: an address cut short is no one to pay, as one
  // missing.
  if (read.link && !read.problem && isBrokenAddress(read.link.to)) {
    return { amount: "", memo: "", problem: LINK_BAD_ADDRESS, to: "" };
  }

  return read.link && !read.problem
    ? {
        amount: linkAmount(read.link, language).field,
        memo: read.link.memo,
        problem: "",
        to: read.link.to,
      }
    : {
        amount: "",
        elsewhere:
          read.reason === "other-network" && text ? elsewhereLink(text) : null,
        memo: "",
        problem: read.problem,
        to: "",
      };
}

/**
 * What a link asks of Send, for the wallet's network, as app-core reads it,
 * the same whether it's scanned or opened: null for what isn't a link, as an
 * address or a name. Send checks what it fills in, as it checks what's
 * typed.
 *
 * @param {string} text
 * @param {import("@dusk-network/networks").Network | null} net The wallet's network
 * @param {string} [language] The language the amount field reads
 * @returns {LinkAsked | null}
 */
export function readPaymentLink(text, net, language) {
  const read = readLink(text.trim(), {
    network: net ?? undefined,
    walletUrl: ownWalletUrl(),
  });

  return read ? askedOf(read, text, language) : null;
}

export { LINK_SEVERAL, LINK_UNCLEAR };

/**
 * What pasted text asks of Send, as app-core reads it for every wallet
 * (`readPastedLink`): a link, as the text starts with one, read whole,
 * spaces and all; else, where it's what Share and Copy give of a request, a
 * line saying what it asks, then "Pay here:" and the link (`requestText`),
 * its one payment link, its last words, read alone. Text with more than one
 * link, or with words after it, which may be part of it, fills in nothing,
 * and says so. Null for text with none, as an address or a name.
 *
 * @param {string} text As it was pasted, its spaces as they were
 * @param {import("@dusk-network/networks").Network | null} net The wallet's network
 * @param {string} [language] The language the amount field reads
 * @returns {LinkAsked | null}
 */
export function readPastedLink(text, net, language) {
  const read = readPasted(text, {
    network: net ?? undefined,
    walletUrl: ownWalletUrl(),
  });

  return read ? askedOf(read, read.text, language) : null;
}

/**
 * The links asking for a payment, as `makePaymentLink` makes them: the https
 * link is to the network's web wallet, or this one where it has none named.
 *
 * @param {Pick<import("@dusk-network/app-core/payment-links").PaymentRequest, "amount" | "amountLux" | "language" | "memo" | "to">} request
 * @param {import("@dusk-network/networks").Network | null} net
 */
export const makeRequestLink = (request, net) =>
  makePaymentLink({
    ...request,
    network: net,
    ...(net?.apps?.wallet ? {} : { walletUrl: ownWalletUrl() }),
  });

/**
 * What Share and Copy give of a request, as both wallets say it
 * (`requestMessage`): "<name> asks you to pay <amount> DUSK · <memo>", on a
 * test network its name too, then "Pay here: <link>". `name` is the
 * profile's verified .dusk name, else the name given it here, "" for none.
 *
 * @param {{ link: string, lux?: bigint | null, memo?: string }} request
 * @param {{ language: string, name: string, net: import("@dusk-network/networks").Network | null }} said
 */
export const requestText = ({ link, lux, memo }, { language, name, net }) =>
  requestMessage({
    language,
    link,
    lux: lux ?? null,
    memo: memo || null,
    name: name || null,
    network: net && net.name !== "mainnet" ? net.label : null,
  });
