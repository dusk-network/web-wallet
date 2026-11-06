/**
 * Asking for a payment and paying what's asked, by a link
 * (`@dusk-network/app-core/payment-links`): what a link asks of Send, as it's
 * pasted, scanned or opened, and the requests this wallet made, kept on this
 * device.
 */

import { base } from "$app/paths";
import {
  amountForField,
  decimalSeparator,
} from "@dusk-network/app-core/amounts";
import {
  makePaymentLink,
  readPaymentLink as readLink,
} from "@dusk-network/app-core/payment-links";

export { matchRequests } from "@dusk-network/app-core/requests";
export {
  forgetRequest,
  forgetWalletRequests,
  hydrateRequests,
  keepRequestMatches,
  rememberRequest,
  requestsStore,
} from "./requests";

/**
 * This web wallet's own address: its Send is read on any network, and links
 * are made for it where the network's file names no web wallet.
 */
export const ownWalletUrl = () => `${location.origin}${base}`;

/**
 * What a link asks of Send, as it's pasted, scanned or opened.
 *
 * @typedef {{ amount: string, memo: string, problem: "", to: string }
 *   | { amount: "", memo: "", problem: string, to: "" }} LinkAsked
 *   `problem` says why it fills in nothing: it can't be read, it says two
 *   amounts, or it's for another network
 */

/**
 * What a link asks of Send, for the wallet's network, as app-core reads it,
 * the same whether it's pasted, scanned or opened: null for what isn't a
 * link, as an address or a name. Send checks what it fills in, as it checks
 * what's typed.
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

  if (!read) {
    return null;
  }

  return read.link && !read.problem
    ? {
        amount: amountForField(
          read.link.amountDusk,
          decimalSeparator(language)
        ),
        memo: read.link.memo,
        problem: "",
        to: read.link.to,
      }
    : { amount: "", memo: "", problem: read.problem, to: "" };
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
