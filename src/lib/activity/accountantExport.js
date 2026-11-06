/**
 * History's Export: one profile's activity as the file an accountant or a tax
 * tool reads (`@dusk-network/app-core/export`), for a quarter or any dates, read
 * whole first: Koinly's universal CSV, the format others follow.
 */

import { migrationsOf } from "@dusk-network/app-core/bridge";
import {
  accountingCsv,
  datesPeriod,
  quarterPeriod,
} from "@dusk-network/app-core/export";

import { get } from "svelte/store";

import { keptMigrations } from "$lib/bridge/migrationActivity";
import { readMigrationsEvm } from "$lib/bridge/migrationEvm";

import { duskEuroPrices } from "./duskPrice";

/**
 * What's asked of a file.
 *
 * @typedef {{
 *   euro: boolean,
 *   excel: boolean,
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
 * it can't be read: nothing half read goes out as if it were all of it.
 *
 * @param {{
 *   choices: ExportChoices,
 *   contactName: (address: string) => string | null | undefined,
 *   net?: import("@dusk-network/networks").Network | null,
 *   network: string,
 *   profile: import("@dusk-network/app-core/export").ExportProfile,
 *   profiles: import("@dusk-network/app-core/export").ExportProfile[],
 *   session: Pick<import("./activitySession").ActivitySession, "sozuFacts" | "whole">,
 * }} asked
 * @returns {Promise<import("@dusk-network/app-core/export").ExportResult & { shieldedWaiting: boolean }>}
 */
export async function makeExport({
  choices,
  contactName,
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
  // What each migration paid on its own chain, its approval with it: by the
  // approval this browser sent for it where it kept one, whose receipt is
  // read at any age, where the chain's logs no longer say.
  const approvals = new Map(
    get(keptMigrations).flatMap(({ approval, hash }) =>
      approval ? [[hash.toLowerCase(), approval]] : []
    )
  );
  // Each payout from the period's start on, after its end too: a fee is
  // written in the period of its own time, never later than its payout, and
  // an approval can come long before its migration.
  const migrations = migrationsOf(
    period
      ? whole.rows.filter(({ time }) => time !== null && time >= period.from)
      : whole.rows
  ).map((migration) => ({
    ...migration,
    approval: approvals.get(migration.hash) ?? null,
  }));
  const evm =
    net && migrations.length
      ? await readMigrationsEvm(net, migrations)
      : undefined;
  const made = await accountingCsv({
    bom: choices.excel,
    contactName: choices.withContacts ? contactName : undefined,
    currency: "EUR",
    evm,
    facts,
    network,
    period,
    price: choices.euro ? duskEuroPrices() : undefined,
    profile,
    profiles,
    rows: whole.rows,
  });

  return { ...made, shieldedWaiting: whole.shieldedWaiting };
}

/**
 * What the file holds, and what it doesn't, once it's saved.
 *
 * @param {Awaited<ReturnType<typeof makeExport>>} made
 */
export function savedWords({ count, left, shieldedWaiting, unpriced }) {
  const out = [
    left.pending ? `${left.pending} on its way` : "",
    left.notRead ? `${left.notRead} not read yet` : "",
  ].filter(Boolean);

  return [
    `CSV saved: ${count === 1 ? "1 line" : `${count} lines`}.`,
    out.length ? `Left out: ${out.join(", ")}.` : "",
    unpriced
      ? `${unpriced === 1 ? "1 line has" : `${unpriced} lines have`} no euro value.`
      : "",
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
