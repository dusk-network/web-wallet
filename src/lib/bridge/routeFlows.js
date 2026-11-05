/**
 * What the Bridge card sends on the routes between Dusk and another chain:
 * - a migration into Dusk, from the connected EVM wallet on its chain: an
 *   approval of the exact amount when the migration contract may take less,
 *   then `migrate(amount, account)`, with this profile's public account as
 *   the recipient; an approval not used up can be revoked;
 * - a transfer out, from this profile's public account: a public transfer to
 *   the route's account, with the connected EVM wallet's address as the
 *   memo, where the route pays it out.
 *
 * Each is sent for the wallet open as it begins: nothing goes out once
 * another wallet opened, or after a lock, and what was sent is kept for
 * that wallet.
 */

import { waitForTransactionReceipt } from "@wagmi/core";
import { get } from "svelte/store";

import { executeSend } from "$lib/contracts";
import { formatDuskExact } from "$lib/dusk/currency";
import { sendPasswordFor } from "$lib/security/sendPassword";
import { walletStore } from "$lib/stores";
import { allowance, approve, migrate } from "$lib/web3/migration";
import { account, wagmiConfig } from "$lib/web3/walletConnection";
import { walletDataScope } from "$lib/wallets/dataNames";

import {
  markMigrationConfirmed,
  markMigrationFailed,
  rememberMigration,
} from "./migrationActivity";

const WEI_PER_LUX = 1_000_000_000n;

/** What a migration stops with once the wallet isn't on the account reviewed. */
export const EVM_ACCOUNT_CHANGED = "EVM_ACCOUNT_CHANGED";

/**
 * Nothing goes out from any account but the one reviewed: an account changed
 * between two steps would pay from one the review never showed.
 *
 * @param {`0x${string}`} owner
 */
function stillOnAccount(owner) {
  if (get(account).address?.toLowerCase() !== owner.toLowerCase()) {
    throw Object.assign(new Error("The EVM wallet changed account."), {
      code: EVM_ACCOUNT_CHANGED,
    });
  }
}

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
 * What the migration contract may take from `owner` as the chain says now, in
 * wei: an approval not used up. Nothing here keeps a record of it.
 *
 * @param {import("./cardRoutes").CardRoute & { kind: "migration" }} route
 * @param {`0x${string}`} owner
 * @returns {Promise<bigint>}
 */
export const approvedWei = async (route, owner) =>
  allowance(
    owner,
    /** @type {`0x${string}`} */ (route.chain.token),
    route.contract,
    route.chain.chainId
  );

/**
 * Whether the migration contract may take the amount from `owner` already,
 * with no approval first.
 *
 * @param {import("./cardRoutes").CardRoute & { kind: "migration" }} route
 * @param {`0x${string}`} owner
 * @param {bigint} amountLux
 */
export const isApproved = async (route, owner, amountLux) =>
  (await approvedWei(route, owner)) >= amountLux * WEI_PER_LUX;

/**
 * Revokes what the migration contract may take from `owner`: a transaction the
 * EVM wallet signs, approving nothing, once it's in a block. With the chain
 * saying it's used up or revoked elsewhere since it was read, there's nothing
 * to sign. Nothing is asked of the wallet once the wallet here, or the screen
 * that says what's going on, is gone.
 *
 * @param {{
 *   onInBlock?: () => void,
 *   owner: `0x${string}`,
 *   route: import("./cardRoutes").CardRoute & { kind: "migration" },
 *   stillHere?: () => void,
 * }} revoke
 * @returns {Promise<void>}
 */
export async function revokeApproval({
  onInBlock = () => {},
  owner,
  route,
  stillHere = () => {},
}) {
  const { chainId, name, token } = route.chain;
  const walletStillOpen = walletStore.whileOpen();

  if ((await approvedWei(route, owner).catch(() => 1n)) === 0n) {
    return;
  }

  walletStillOpen();
  stillHere();
  stillOnAccount(owner);

  const hash = await approve(
    route.contract,
    /** @type {`0x${string}`} */ (token),
    0n,
    chainId,
    owner
  );

  onInBlock();

  const revoked = await waitForTransactionReceipt(wagmiConfig, {
    chainId,
    hash,
  });

  if (revoked.status !== "success") {
    throw new Error(`The revoke didn't go through on ${name}.`);
  }
}

/**
 * Approves the exact amount for the migration contract, when it may take
 * less, and waits for the approval to go through.
 *
 * @param {import("./cardRoutes").CardRoute & { kind: "migration" }} route
 * @param {`0x${string}`} owner
 * @param {bigint} amountLux
 * @param {() => void} onApproving
 * @param {() => void} stillOpen Throws once the wallet it's for isn't open
 */
async function approveIfShort(route, owner, amountLux, onApproving, stillOpen) {
  const { chainId, name, token } = route.chain;

  if (await isApproved(route, owner, amountLux)) {
    return;
  }

  stillOpen();
  stillOnAccount(owner);
  onApproving();

  const hash = await approve(
    route.contract,
    /** @type {`0x${string}`} */ (token),
    amountLux * WEI_PER_LUX,
    chainId,
    owner
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
 *   stillHere?: () => void,
 * }} migration
 * @returns {Promise<`0x${string}`>}
 */
export async function sendMigration({
  amountLux,
  onStep = () => {},
  owner,
  recipient,
  route,
  stillHere = () => {},
}) {
  const { chainId, name } = route.chain;
  const walletStillOpen = walletStore.whileOpen();
  // Nothing more is asked of the wallet once the wallet here, or the screen
  // that says what's going on, is gone.
  const stillOpen = () => {
    walletStillOpen();
    stillHere();
  };
  const scope = walletDataScope();

  // Above the amount chosen in Settings, the password comes first.
  await sendPasswordFor(amountLux, get(walletStore).walletKey);
  stillOpen();

  await approveIfShort(
    route,
    owner,
    amountLux,
    () => onStep("approving"),
    stillOpen
  );
  stillOpen();
  stillOnAccount(owner);
  onStep("migrating");

  const hash = await migrate(
    amountLux * WEI_PER_LUX,
    chainId,
    recipient,
    route.contract,
    owner
  );

  // Sent: kept for its wallet, whichever is open now.
  rememberMigration(
    {
      amountLux: String(amountLux),
      createdAt: Date.now(),
      hash,
      recipient,
      routeId: route.id,
      sender: owner,
    },
    scope
  );
  onStep("confirming");

  const migrated = await waitForTransactionReceipt(wagmiConfig, {
    chainId,
    hash,
  });

  if (migrated.status !== "success") {
    markMigrationFailed(hash, scope);

    throw new Error(`The migration didn't go through on ${name}.`);
  }

  markMigrationConfirmed(hash, scope);

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
