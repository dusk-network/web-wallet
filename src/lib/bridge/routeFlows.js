/**
 * What the Bridge card sends on the routes between Dusk and another chain:
 * - a migration into Dusk, from the connected EVM wallet on its chain: an
 *   approval of the exact amount when the migration contract may take less,
 *   then `migrate(amount, account)`, with this profile's public account as
 *   the recipient;
 * - a transfer out, from this profile's public account: a public transfer to
 *   the route's account, with the connected EVM wallet's address as the
 *   memo, where the route pays it out.
 */

import { waitForTransactionReceipt } from "@wagmi/core";

import { executeSend } from "$lib/contracts";
import { formatDuskExact } from "$lib/dusk/currency";
import { allowance, approve, migrate } from "$lib/web3/migration";
import { wagmiConfig } from "$lib/web3/walletConnection";

import {
  markMigrationConfirmed,
  markMigrationFailed,
  rememberMigration,
} from "./migrationActivity";

const WEI_PER_LUX = 1_000_000_000n;

/**
 * What a transfer to a route's account comes to, in one line, as the
 * wallet extension says it: "2 DUSK sent · 1 DUSK bridge fee · 1 DUSK
 * arrives on BNB Smart Chain", or that nothing arrives when the fee takes
 * it all.
 *
 * @param {{ chain: string, feeLux: bigint, sentLux: bigint }} transfer
 * @param {string} [locale]
 */
export function serviceLine({ chain, feeLux, sentLux }, locale) {
  const arrives =
    sentLux > feeLux
      ? `${formatDuskExact(sentLux - feeLux, locale)} DUSK arrives on ${chain}`
      : `Nothing arrives on ${chain}`;

  return `${formatDuskExact(sentLux, locale)} DUSK sent · ${formatDuskExact(feeLux, locale)} DUSK bridge fee · ${arrives}`;
}

/**
 * Whether the migration contract may take the amount from `owner` already,
 * with no approval first.
 *
 * @param {import("./cardRoutes").CardRoute & { kind: "migration" }} route
 * @param {`0x${string}`} owner
 * @param {bigint} amountLux
 */
export const isApproved = async (route, owner, amountLux) =>
  (await allowance(
    owner,
    /** @type {`0x${string}`} */ (route.chain.token),
    route.contract,
    route.chain.chainId
  )) >=
  amountLux * WEI_PER_LUX;

/**
 * Approves the exact amount for the migration contract, when it may take
 * less, and waits for the approval to go through.
 *
 * @param {import("./cardRoutes").CardRoute & { kind: "migration" }} route
 * @param {`0x${string}`} owner
 * @param {bigint} amountLux
 * @param {() => void} onApproving
 */
async function approveIfShort(route, owner, amountLux, onApproving) {
  const { chainId, name, token } = route.chain;

  if (await isApproved(route, owner, amountLux)) {
    return;
  }

  onApproving();

  const hash = await approve(
    route.contract,
    /** @type {`0x${string}`} */ (token),
    amountLux * WEI_PER_LUX,
    chainId
  );
  const approved = await waitForTransactionReceipt(wagmiConfig, {
    chainId,
    hash,
  });

  if (approved.status !== "success") {
    throw new Error(`The approval didn't go through on ${name}.`);
  }
}

/**
 * Sends a migration, step by step: an approval of the exact amount when the
 * contract may take less, then the migration. It's kept for Bridge ›
 * Activity as soon as it's sent, and its hash given once it's in a block.
 *
 * @param {{
 *   amountLux: bigint,
 *   onStep?: (step: "approving" | "confirming" | "migrating") => void,
 *   owner: `0x${string}`,
 *   recipient: string,
 *   route: import("./cardRoutes").CardRoute & { kind: "migration" },
 * }} migration
 * @returns {Promise<`0x${string}`>}
 */
export async function sendMigration({
  amountLux,
  onStep = () => {},
  owner,
  recipient,
  route,
}) {
  const { chainId, name } = route.chain;

  await approveIfShort(route, owner, amountLux, () => onStep("approving"));
  onStep("migrating");

  const hash = await migrate(
    amountLux * WEI_PER_LUX,
    chainId,
    recipient,
    route.contract
  );

  rememberMigration({
    amountLux: String(amountLux),
    createdAt: Date.now(),
    hash,
    recipient,
    routeId: route.id,
    sender: owner,
  });
  onStep("confirming");

  const migrated = await waitForTransactionReceipt(wagmiConfig, {
    chainId,
    hash,
  });

  if (migrated.status !== "success") {
    markMigrationFailed(hash);

    throw new Error(`The migration didn't go through on ${name}.`);
  }

  markMigrationConfirmed(hash);

  return hash;
}

/**
 * Sends DUSK out to another chain: a public transfer to the route's
 * account, with the address it pays as the memo.
 *
 * @param {{
 *   amountLux: bigint,
 *   gasLimit: bigint,
 *   gasPrice: bigint,
 *   recipient: `0x${string}`,
 *   route: import("./cardRoutes").CardRoute & { kind: "service" },
 * }} transfer
 * @returns {Promise<string>} The Dusk transaction's hash
 */
export const sendServiceTransfer = ({
  amountLux,
  gasLimit,
  gasPrice,
  recipient,
  route,
}) => executeSend(route.account, amountLux, recipient, gasPrice, gasLimit);
