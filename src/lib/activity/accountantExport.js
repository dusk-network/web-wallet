/**
 * History's Export: one profile's activity as the file an accountant or a tax
 * tool reads (`@dusk-network/app-core/export`), for a quarter or any dates, read
 * whole first: Koinly's universal CSV, the format others follow.
 */

import { defaultCurrency } from "@dusk-network/app-core/amounts";
import { bridgedTo } from "@dusk-network/app-core/bridge";
import {
  accountingCsv,
  datesPeriod,
  quarterPeriod,
  rewardsByYear,
} from "@dusk-network/app-core/export";

import { get } from "svelte/store";

import { keptMigrations } from "$lib/bridge/migrationActivity";
import { currencies } from "$lib/dusk/currency";
import { shortenAddress } from "$lib/dusk/string";

import { duskPrices } from "./duskPrice";

/**
 * The currency an export's values are in: the one chosen for the wallet's
 * amounts, which CoinGecko prices DUSK in, else the one the browser's region
 * starts on (app-core's `defaultCurrency`).
 *
 * @param {string} [chosen] Settings' currency
 * @param {string} [language] The browser's
 * @returns {string}
 */
export const exportCurrency = (chosen, language) =>
  currencies.some(({ code }) => code === chosen)
    ? /** @type {string} */ (chosen)
    : defaultCurrency(language);

/**
 * What a currency's values are called in the export's words, as English
 * names them: "Indian rupees", one "Indian rupee".
 *
 * @param {string} currency
 */
export function currencyWords(currency) {
  /**
   * @param {number} amount
   * @param {Intl.NumberFormatOptions} [options]
   */
  const named = (amount, options) =>
    new Intl.NumberFormat("en", {
      currency,
      currencyDisplay: "name",
      style: "currency",
      ...options,
    })
      .formatToParts(amount)
      .find(({ type }) => type === "currency")?.value ?? currency;

  return {
    many: named(2),
    one: named(1, { maximumFractionDigits: 0, minimumFractionDigits: 0 }),
  };
}

/**
 * The EVM addresses known here as the person's, whichever profile's they
 * are, each once: connected here now, or added, and those this browser sent a
 * migration from.
 *
 * @param {Iterable<string>} [connected]
 * @returns {string[]}
 */
export function knownEvmAddresses(connected = []) {
  /** @type {Map<string, string>} */
  const known = new Map();

  for (const address of [
    ...connected,
    ...get(keptMigrations).map(({ sender }) => sender),
  ]) {
    if (address && !known.has(address.toLowerCase())) {
      known.set(address.toLowerCase(), address);
    }
  }

  return [...known.values()];
}

/**
 * The EVM addresses a profile's file has the gas of, as far as is known
 * before it's made, each once: one this browser sent a migration into the
 * profile from, one the profile's rows bridged DUSK to, or one added for its
 * files. The address connected here is the person's too, and its gas is in
 * the file where its migrations paid the profile: said once the file is made
 * (`savedWords`).
 *
 * @param {{ account: string, added?: Iterable<string>, rows?: ActivityRow[] }} profile
 * @returns {{ address: string, why: "added" | "bridged" | "migrated" }[]}
 */
export function evmAddressesOf({ account, added = [], rows = [] }) {
  /** @type {Map<string, { address: string, why: "added" | "bridged" | "migrated" }>} */
  const known = new Map();

  /**
   * @param {Iterable<string>} addresses
   * @param {"added" | "bridged" | "migrated"} why
   */
  const take = (addresses, why) => {
    for (const address of addresses) {
      if (address && !known.has(address.toLowerCase())) {
        known.set(address.toLowerCase(), { address, why });
      }
    }
  };

  take(
    get(keptMigrations)
      .filter(({ recipient }) => recipient === account)
      .map(({ sender }) => sender),
    "migrated"
  );
  take(bridgedTo(rows), "bridged");
  take(added, "added");

  return [...known.values()];
}

/**
 * What each migration's side on its own chain and the person's approvals and
 * revokes there are, as read for files: what's final is read once while the
 * page is open.
 */
const exportChainCache = new Map();

/** A number as two digits. */
const twoDigits = (/** @type {number} */ n) => String(n).padStart(2, "0");

/**
 * A file's name with when it was made before its extension, to the minute in
 * the device's time, as the extension names its files, so no two share one:
 * "dusk-profile-1-testnet-all-2026-11-10-0412.csv".
 *
 * @param {string} name
 * @param {number} [at]
 */
export function stampedName(name, at = Date.now()) {
  const made = new Date(at);
  const stamp = [
    made.getFullYear(),
    twoDigits(made.getMonth() + 1),
    twoDigits(made.getDate()),
    `${twoDigits(made.getHours())}${twoDigits(made.getMinutes())}`,
  ].join("-");

  return name.replace(
    /(\.[a-z0-9]+)?$/i,
    (extension) => `-${stamp}${extension}`
  );
}

/**
 * What's asked of a file.
 *
 * @typedef {{
 *   excel: boolean,
 *   fiat: boolean,
 *   from: string,
 *   period: string,
 *   to: string,
 *   withContacts: boolean,
 * }} ExportChoices
 *   `period` a quarter, as "2026-4", "all" or "dates", with `from` and `to`
 */

/**
 * The span asked for: none for all of it. Throws what's wrong with it.
 *
 * @param {Pick<ExportChoices, "from" | "period" | "to">} choices
 * @returns {import("@dusk-network/app-core/export").ExportPeriod | undefined}
 */
export function periodOf({ from, period, to }) {
  if (!period || period === "all") {
    return undefined;
  }

  if (period === "dates") {
    if (!from || !to) {
      throw new RangeError("Choose both days.");
    }

    return datesPeriod(from, to);
  }

  const [year, quarter] = period.split("-").map(Number);

  return quarterPeriod(year, quarter);
}

/**
 * What can be asked for: all of it, the current quarter and the seven before
 * it, newest first, and any dates.
 *
 * @param {Date} [now]
 * @returns {SelectOption[]}
 */
export function periodChoices(now = new Date()) {
  let year = now.getFullYear();
  let quarter = Math.floor(now.getMonth() / 3) + 1;
  const quarters = [];

  for (let i = 0; i < 8; i += 1) {
    quarters.push({
      label: `Q${quarter} ${year}`,
      value: `${year}-${quarter}`,
    });
    quarter -= 1;

    if (!quarter) {
      quarter = 4;
      year -= 1;
    }
  }

  return [
    { label: "All activity", value: "all" },
    ...quarters,
    { label: "Choose dates", value: "dates" },
  ];
}

/**
 * The file asked for, from the account's whole history. Throws what to say when
 * it can't be read: nothing half read goes out as if it were all of it. A
 * migration's gas on its own chain is the person's cost only where it was
 * sent from an EVM address of theirs: one the profile's rows bridged DUSK to,
 * one connected now or added for the file (`evmConnected`), or one this
 * browser sent a migration from. Anyone can migrate to an account, as a
 * customer to a shop's. So are those addresses' approvals and revokes there,
 * each in the file of the profile its migration paid, as app-core reads and
 * books them, as the extension does.
 *
 * @param {{
 *   choices: ExportChoices,
 *   contactName: (address: string) => string | null | undefined,
 *   currency?: string,
 *   evmConnected?: Iterable<string>,
 *   net?: import("@dusk-network/networks").Network | null,
 *   network: string,
 *   profile: import("@dusk-network/app-core/export").ExportProfile,
 *   profiles: import("@dusk-network/app-core/export").ExportProfile[],
 *   session: Pick<import("./activitySession").ActivitySession, "sozuFacts" | "whole"> & { archive?: import("@dusk-network/app-core/history").Archive },
 * }} asked
 * @returns {Promise<import("@dusk-network/app-core/export").ExportResult & { currency: string, hasOtherProfiles: boolean, shieldedWaiting: boolean }>}
 */
export async function makeExport({
  choices,
  contactName,
  currency = "EUR",
  evmConnected = [],
  net = null,
  network,
  profile,
  profiles,
  session,
}) {
  const period = periodOf(choices);
  const whole = await session.whole().catch(() => {
    throw new Error(
      "Couldn't read your whole history from this node, so nothing was saved. Try again."
    );
  });
  // A stake whose stDUSK can't be read yet says so in its line.
  const facts = await session.sozuFacts(whole.rows).catch(() => undefined);
  // The approval this browser sent for each migration it sent, by the
  // migration's hash, whose receipt is read at any age, where the chain's
  // logs no longer say.
  const kept = get(keptMigrations);
  const approvals = new Map(
    kept.flatMap(({ approval, hash }) =>
      approval ? [[hash.toLowerCase(), approval]] : []
    )
  );
  const made = await accountingCsv({
    bom: choices.excel,
    // The archive says which profile bridged to an address that never
    // migrated, whose approvals are that profile's.
    bridge: net
      ? {
          approvalOf: (hash) => approvals.get(hash.toLowerCase()) ?? null,
          archive: session.archive,
          cache: exportChainCache,
          network: net,
        }
      : undefined,
    contactName: choices.withContacts ? contactName : undefined,
    currency,
    // The person's beside those the rows bridged to: whose gas is in this
    // profile's file only where their migrations paid it.
    evmAddresses: knownEvmAddresses(evmConnected),
    facts,
    network,
    period,
    price: choices.fiat ? duskPrices({ currency }) : undefined,
    profile,
    profiles,
    rows: whole.rows,
  });

  return {
    ...made,
    currency,
    // Whose file an approval is can't always be told: another of the
    // person's profiles may have it.
    hasOtherProfiles: profiles.some(
      ({ account }) => Boolean(account) && account !== profile.account
    ),
    shieldedWaiting: whole.shieldedWaiting,
  };
}

/**
 * What one stDUSK was worth at each new year, as read from the chain: kept
 * while the page is, as it doesn't change.
 */
const newYearRates = new Map();

/**
 * Staking rewards by calendar year, from the account's whole history, as the
 * file has them: native staking's claimed; what Sozu's stDUSK grew while
 * held, by its rate at each new year, read from the chain, and what it's
 * worth now (`sozuStatus`); and what Sozu's unstakes took out beyond what
 * their stDUSK cost. In DUSK, and in `currency` where `fiat` asks, from
 * CoinGecko's prices. Throws what to say when it can't be read.
 *
 * @param {{
 *   currency: string,
 *   fiat: boolean,
 *   session: Pick<import("./activitySession").ActivitySession, "sozuFacts" | "whole"> & { archive?: import("@dusk-network/app-core/history").Archive },
 *   sozuStatus: () => Promise<SozuStatus | null>,
 * }} asked `sozuStatus`: Sozu's, read now for the account
 */
export async function readRewardsByYear({
  currency,
  fiat,
  session,
  sozuStatus,
}) {
  const whole = await session.whole().catch(() => {
    throw new Error(
      "Couldn't read your whole history from this node. Try again."
    );
  });
  const [facts, status] = await Promise.all([
    session.sozuFacts(whole.rows).catch(() => undefined),
    sozuStatus().catch(() => null),
  ]);
  const years = await rewardsByYear({
    archive: session.archive,
    cache: newYearRates,
    facts,
    price: fiat ? duskPrices({ currency }) : undefined,
    rows: whole.rows,
    status,
  });

  return {
    currency: fiat ? currency : null,
    shieldedWaiting: whole.shieldedWaiting,
    years,
  };
}

/**
 * How long rewards by year wait before they're read again while a year
 * leaves out a new stake's or unstake's facts, not read yet (`reading`), in
 * milliseconds.
 */
export const REWARDS_AGAIN_MS = 20_000;

/**
 * Rewards by year, read now, and again after REWARDS_AGAIN_MS for as long as
 * a year leaves out a stake's or unstake's facts not read yet, which the
 * archive lists a little after its block: each read is told, as what was
 * read before stands meanwhile, until it's stopped.
 *
 * @param {Parameters<typeof readRewardsByYear>[0]} asked
 * @param {{ onError: (error: Error) => void, onRead: (read: Awaited<ReturnType<typeof readRewardsByYear>>) => void }} told
 * @returns {() => void} Stops
 */
export function followRewardsByYear(asked, { onError, onRead }) {
  let isStopped = false;

  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let timer;

  const read = () =>
    readRewardsByYear(asked).then(
      (result) => {
        if (isStopped) {
          return;
        }

        onRead(result);

        if (result.years.some(({ reading }) => reading > 0)) {
          timer = setTimeout(read, REWARDS_AGAIN_MS);
        }
      },
      (error) => {
        if (!isStopped) {
          onError(error);
        }
      }
    );

  void read();

  return () => {
    isStopped = true;
    clearTimeout(timer);
  };
}

/**
 * What the file holds, and what it doesn't, once it's saved: whose network
 * fees of migrations it has, and those it couldn't read, or, with other
 * profiles, those another profile's file may have, as the extension says
 * them.
 *
 * @param {Awaited<ReturnType<typeof makeExport>>} made
 */
export function savedWords({
  count,
  currency,
  evm,
  hasOtherProfiles,
  left,
  shieldedWaiting,
  unpriced,
}) {
  const out = [
    left.pending ? `${left.pending} on its way` : "",
    left.notRead ? `${left.notRead} not read yet` : "",
  ].filter(Boolean);
  const chains = [...new Set(evm.unread.map(({ chain }) => chain))];
  const unread = evm.unread.length;
  // Approvals and revokes there it couldn't all read: for now, or before a
  // block. With other profiles, one whose file it can't tell may be in theirs.
  const failed = evm.approvalsUnread.filter(({ state }) => state === "error");
  const failedOn = [
    ...new Set(failed.map(({ chain }) => chain).filter(Boolean)),
  ];
  const failedWhere = failedOn.length === 1 ? ` on ${failedOn[0]}` : "";
  const before = new Map(
    evm.approvalsUnread
      .filter(({ from, state }) => state !== "error" && from !== null)
      .map(({ chain, from }) => [`${chain}\n${from}`, { chain, from }])
  );

  return [
    `CSV saved: ${count === 1 ? "1 line" : `${count} lines`}.`,
    out.length ? `Left out: ${out.join(", ")}.` : "",
    unpriced
      ? `${unpriced === 1 ? "1 line has" : `${unpriced} lines have`} no ${currencyWords(currency).one} value.`
      : "",
    evm.booked.length
      ? `The file has the network fees paid from ${new Intl.ListFormat("en", { type: "conjunction" }).format(evm.booked.map((address) => shortenAddress(address)))}.`
      : "",
    unread
      ? `${unread === 1 ? "1 migration's fee" : `${unread} migrations' fees`} on ${chains.length === 1 ? chains[0] : "their chains"} couldn't be read: export again to add ${unread === 1 ? "it" : "them"}.`
      : "",
    failed.length
      ? hasOtherProfiles
        ? `Some network fees${failedWhere} may be in another profile's file, or couldn't be read: export again to add them.`
        : `Some network fees${failedWhere} couldn't be read: export again to add them.`
      : "",
    ...[...before.values()].map(
      ({ chain, from }) =>
        `Network fees on ${chain || "its chain"} from before block ${Number(from).toLocaleString("en")} aren't in the file.`
    ),
    shieldedWaiting
      ? "Your shielded activity is still syncing: export again once it's done."
      : "",
  ]
    .filter(Boolean)
    .join(" ");
}

/**
 * What the wallets here call their profiles, but one's, as the file's own
 * profiles: what moves between them is a transfer, not income.
 *
 * @param {Map<string, string>} names `walletAccountNames`
 * @param {string[]} own The public account and shielded address the file is of
 * @returns {import("@dusk-network/app-core/export").ExportProfile[]}
 */
export const otherProfiles = (names, own) =>
  Array.from(names)
    .filter(([address]) => !own.includes(address))
    .map(([address, label]) =>
      label.endsWith(", shielded")
        ? { address, name: label.slice(0, -", shielded".length) }
        : { account: address, name: label }
    );
