<svelte:options immutable={true} />

<script>
  import { amountForField, readAmount } from "@dusk-network/app-core/amounts";
  /**
   * The Bridge card on a migration into Dusk, from BNB Smart Chain or
   * Ethereum: the connected EVM wallet, on the route's chain, pays the
   * route's migration contract, which the route's payout account pays out
   * on Dusk to this profile's public account.
   */
  import { pushState } from "$app/navigation";
  import { page } from "$app/stores";
  import { createEventDispatcher, onDestroy, tick } from "svelte";
  import { formatUnits } from "viem";
  import {
    mdiArrowDown,
    mdiArrowLeft,
    mdiArrowUpBoldBoxOutline,
    mdiChevronDown,
    mdiClockOutline,
  } from "@mdi/js";

  import { Button, Icon } from "$lib/dusk/components";
  import {
    figureWidth,
    formatDusk,
    formatDuskExact,
    formatDuskPlain,
  } from "$lib/dusk/currency";
  import { getDecimalSeparator } from "$lib/dusk/number";
  import { shortenAddress } from "$lib/dusk/string";
  import { SendPasswordDeclinedError } from "$lib/errors";
  import { formDraft } from "$lib/navigation";
  import { settingsStore, walletStore } from "$lib/stores";
  import { account, modal } from "$lib/web3/walletConnection";
  import { getBalanceOfCoin } from "$lib/web3/migration";
  import { notRunning } from "$lib/bridge/cardRoutes";
  import {
    approvedWei,
    isApproved,
    EVM_ACCOUNT_CHANGED,
    revokeApproval,
    sendMigration,
  } from "$lib/bridge/routeFlows";
  import { askToSwitch, isAskingToSwitch } from "$lib/bridge/chainSwitch";
  import {
    getMigrationFee,
    getNativeBalance,
    getRevokeFee,
  } from "$lib/web3/migration";
  import { describeFailure, isDeclinedInWallet } from "$lib/transactions";
  import { routeTime, routeTimeText } from "$lib/bridge/routeTimes";

  import AmountQuestion from "../AmountQuestion/AmountQuestion.svelte";
  import BalanceValue from "../BalanceValue/BalanceValue.svelte";
  import AddDusk from "./AddDusk.svelte";
  import NetworkMark from "../NetworkPicker/NetworkMark.svelte";
  import NetworkPicker from "../NetworkPicker/NetworkPicker.svelte";
  import OperationResult from "../OperationResult/OperationResult.svelte";
  import RouteStatusLine from "./RouteStatusLine.svelte";
  import RouteTransferResult from "./RouteTransferResult.svelte";
  import FullAddress from "../FullAddress/FullAddress.svelte";
  import ReviewWallet from "../ReviewWallet/ReviewWallet.svelte";
  import SectionHead from "../SectionHead/SectionHead.svelte";
  import { amountProblem, readDuskInput } from "../Stake/stakeAmount";

  /** @type {import("$lib/bridge/cardRoutes").CardRoute & { kind: "migration" }} */
  export let route;

  /** @type {import("$lib/bridge/cardRoutes").CardChoice[]} */
  export let fromChoices;

  /** @type {import("$lib/bridge/cardRoutes").CardChoice[]} */
  export let toChoices;

  /** Whether the flip has a way back to go to. */
  export let canFlip = false;

  /** The network, for why a route that isn't running can't be used. */
  /** @type {import("@dusk-network/networks").Network | null} */
  export let net = null;

  /** This profile's public account, which the migration pays. */
  /** @type {string} */
  export let recipient;

  const dispatch = createEventDispatcher();
  const WEI_PER_LUX = 1_000_000_000n;

  /** Past what any token has: an approval with no limit, as wallets give one. */
  const NO_LIMIT = 2n ** 255n;
  const ACCOUNT_CHANGED_NOTE =
    "Your EVM wallet switched to another account, so nothing moved. Review again.";

  /** Whether the swap keeps focus: the direction just changed by it. */
  export let focusSwap = false;

  const takeFocusIf = (
    /** @type {HTMLElement} */ node,
    /** @type {boolean} */ yes,
  ) => {
    if (yes) {
      node.focus();
    }
  };

  /** A step's heading takes focus as it shows, so a screen reader goes there. */
  const takeFocus = (/** @type {HTMLElement} */ node) => node.focus();

  /** A review's heading takes focus as it shows: its section head. */
  const focusHead = (/** @type {HTMLElement} */ node) =>
    node.querySelector("h2")?.focus();

  const draft = formDraft(`bridge-${route.id}`);

  /** What was typed before a lock, a reload or a failed migration. */
  const typedBefore = draft.read();

  /** @type {string} */
  let amount = typedBefore?.amount ?? "";

  /**
   * An amount of the chain's own currency, rounded as a wallet shows it.
   *
   * @param {bigint} wei
   */
  function feeText(wei) {
    const { decimals } = route.chain.currency;
    const shown = Number(formatUnits(wei, decimals));

    return shown.toLocaleString(
      language,
      shown < 1
        ? { maximumSignificantDigits: 2 }
        : { maximumFractionDigits: 4 },
    );
  }

  /** @param {Event} event */
  function typeAmount(event) {
    note = "";
    amount = /** @type {HTMLInputElement} */ (event.currentTarget).value;
  }

  /** The token's balance in the wallet, in wei, once read. */
  /** @type {bigint | undefined} */
  let balance;

  /**
   * What the wallet holds to pay network fees with: undefined until it's
   * read, null when it couldn't be.
   *
   * @type {bigint | null | undefined}
   */
  let feeBalance;

  /** How many times it was read: only the last answer counts. */
  let feeReads = 0;

  /** About what it costs in network fees, once it's estimated. */
  /** @type {bigint | null} */
  let feeEstimate = null;

  /** Whether the contract may take the amount without an approval first. */
  /** @type {boolean | undefined} */
  let approved;

  /**
   * What an approval from before lets the contract take, in wei, as the review
   * read it: what it's for and what stays of it, when it covers the amount.
   *
   * @type {bigint}
   */
  let reviewedApproval = 0n;

  /**
   * What the contract may take as the form shows, in wei, read on the chain:
   * undefined until it's read, as when it can't be.
   *
   * @type {bigint | undefined}
   */
  let openApproval;

  /** How many times it was read: only the last answer counts. */
  let openApprovalReads = 0;

  /** Where its revoke is. */
  /** @type {"" | "in-block" | "signing"} */
  let revoking = "";

  /** @type {"form" | "result" | "review" | "revoke"} */
  let step = "form";

  /**
   * About what the revoke reviewed costs in network fees, once estimated,
   * and what the wallet holds to pay them: undefined until it's read, null
   * where it couldn't be.
   *
   * @type {{ balance: bigint | null | undefined, fee: bigint | null }}
   */
  let revokeFees = { balance: undefined, fee: null };

  /** How many times they were read: only the last answer counts. */
  let revokeFeeReads = 0;

  /** Where a migration that was sent is. */
  /** @type {"" | "approving" | "confirming" | "migrating"} */
  let sending = "";

  /** @type {Promise<string>} */
  let operation = Promise.resolve("");

  /** The result's heading, once it's sent. */
  let sentHeading = "Migration sent";

  /** Whether this screen is gone: it then asks the wallet for nothing more. */
  let left = false;

  onDestroy(() => {
    left = true;
  });

  /** For what acts after it waits, right before it asks the wallet. */
  function stillHere() {
    if (left) {
      throw new Error("The screen was left.");
    }
  }

  /** Whether what failed can't have gone out, so it can be tried again. */
  let canGoBack = false;

  /**
   * Whether the migration failed with nothing sent as the approval, read again
   * then, no longer covers it, as once it was used elsewhere.
   */
  let isApprovalShort = false;

  /** What just stopped it, for the screen it went back to. */
  let note = "";

  /** The account the review open is for. */
  /** @type {string | undefined} */
  let reviewedFor;

  /** What the balance shown is read for: an account on a chain. */
  let readFor = "";

  /**
   * Reads the token's balance of the connected account on the route's
   * chain, once per account and chain; forgets it without one.
   *
   * @param {string | undefined} owner
   * @param {number | undefined} chainId
   */
  function follow(owner, chainId) {
    const key = owner && chainId ? `${owner}:${route.id}:${chainId}` : "";

    if (key === readFor) {
      return;
    }

    readFor = key;
    balance = undefined;

    if (!key || chainId !== route.chain.chainId) {
      return;
    }

    getBalanceOfCoin(
      /** @type {`0x${string}`} */ (owner),
      /** @type {`0x${string}`} */ (route.chain.token),
      chainId,
    ).then(
      (wei) => {
        if (readFor === key) {
          balance = wei;
        }
      },
      () => {
        if (readFor === key) {
          balance = 0n;
        }
      },
    );
  }

  /**
   * Reads on the chain what the contract may take from `owner`: none without
   * one, as away from the form or on another chain.
   *
   * @param {string | undefined} owner
   */
  function readOpenApproval(owner) {
    const read = ++openApprovalReads;

    if (!owner) {
      openApproval = undefined;

      return;
    }

    approvedWei(route, /** @type {`0x${string}`} */ (owner)).then(
      (wei) => {
        if (read === openApprovalReads) {
          openApproval = wei;
        }
      },
      () => {
        if (read === openApprovalReads) {
          openApproval = undefined;
        }
      },
    );
  }

  /**
   * What's approved, as the screen says it: for less than a lux, that.
   *
   * @param {bigint} wei
   */
  const approvalText = (wei) =>
    wei < WEI_PER_LUX
      ? `less than ${formatDuskExact(1n, language)}`
      : formatDuskExact(wei / WEI_PER_LUX, language);

  /** On to the review of the amount the approval open still lets go. */
  async function finish() {
    amount = amountForField(
      formatDuskPlain(finishLux),
      getDecimalSeparator(language),
    );
    note = "";
    await tick();

    if (primary.ready) {
      goToReview();
    }
  }

  /**
   * Asks the wallet to take back what the contract may take, as reviewed: a
   * transaction. Done, or for another account, back to the form; refused or
   * failed, the review stays, saying so.
   */
  async function revoke() {
    const owner = /** @type {`0x${string}`} */ (address);

    note = "";
    revoking = "signing";

    try {
      await forThisWallet(revokeApproval)({
        onInBlock: () => {
          revoking = "in-block";
        },
        owner,
        route,
        stillHere,
      });

      note = "The allowance is revoked.";
      leaveRevokeReview();
    } catch (error) {
      const isOtherAccount =
        /** @type {{ code?: string }} */ (error)?.code === EVM_ACCOUNT_CHANGED;

      note = isOtherAccount
        ? ACCOUNT_CHANGED_NOTE
        : isDeclinedInWallet(error)
          ? "You cancelled the revoke in your wallet. The allowance stands."
          : "The allowance wasn't revoked. Check your EVM wallet's activity before trying again.";

      if (isOtherAccount) {
        leaveRevokeReview();
      }
    } finally {
      revoking = "";

      if (!left) {
        readOpenApproval(
          step === "form" || step === "revoke" ? address : undefined,
        );
      }
    }
  }

  /** What the revoke reviewed costs, and what the wallet holds to pay it. */
  function readRevokeFees() {
    const read = ++revokeFeeReads;
    const owner = /** @type {`0x${string}`} */ (address);

    revokeFees = { balance: undefined, fee: null };
    getNativeBalance(owner, route.chain.chainId).then(
      (wei) => {
        if (read === revokeFeeReads) {
          revokeFees = { ...revokeFees, balance: wei };
        }
      },
      () => {
        if (read === revokeFeeReads) {
          revokeFees = { ...revokeFees, balance: null };
        }
      },
    );
    getRevokeFee({
      chainId: route.chain.chainId,
      migrationContract: route.contract,
      owner,
      stableCoinAddress: /** @type {`0x${string}`} */ (route.chain.token),
    }).then(
      (wei) => {
        if (read === revokeFeeReads) {
          revokeFees = { ...revokeFees, fee: wei };
        }
      },
      () => {},
    );
  }

  function reviewRevoke() {
    note = "";
    reviewedFor = address;
    step = "revoke";
    readRevokeFees();
  }

  /** The revoke's review: a step of its own in the history, as a migration's. */
  function goToRevokeReview() {
    if (!$page.state?.routeRevoke) {
      pushState("", { routeRevoke: true });
    }

    reviewRevoke();
  }

  /**
   * Back to the form from the revoke's review, its step in the history gone
   * with it. Once this screen is gone, as a revoke sent from it ends, it moves
   * the history no more: the step there may be a newer screen's review.
   */
  function leaveRevokeReview() {
    if ($page.state?.routeRevoke && !left) {
      history.back();
    }

    if (step === "revoke") {
      step = "form";
    }
  }

  /**
   * The step a phone's Back or Forward takes a revoke's review to: a review
   * only of an approval still open, with its wallet.
   *
   * @param {boolean} isAtRevoke
   */
  function followRevokeHistory(isAtRevoke) {
    if (step === "revoke" && !isAtRevoke) {
      step = "form";
    } else if (
      step === "form" &&
      isAtRevoke &&
      hasOpenApproval &&
      isConnected &&
      !revoking
    ) {
      reviewRevoke();
    }
  }

  function readApproval() {
    approved = undefined;
    reviewedApproval = 0n;
    feeBalance = undefined;

    feeEstimate = null;

    const read = ++feeReads;
    const owner = /** @type {`0x${string}`} */ (address);

    getNativeBalance(owner, route.chain.chainId).then(
      (wei) => {
        if (read === feeReads) {
          feeBalance = wei;
        }
      },
      () => {
        if (read === feeReads) {
          feeBalance = null;
        }
      },
    );
    approvedWei(route, owner).then(
      (wei) => {
        const yes = wei >= amountLux * WEI_PER_LUX;

        approved = yes;
        reviewedApproval = wei;
        getMigrationFee({
          amount: amountLux * WEI_PER_LUX,
          approved: yes,
          chainId: route.chain.chainId,
          migrationContract: route.contract,
          owner,
          recipient,
          stableCoinAddress: /** @type {`0x${string}`} */ (route.chain.token),
        }).then(
          (wei) => {
            if (read === feeReads) {
              feeEstimate = wei;
            }
          },
          () => {},
        );
      },
      () => {
        approved = false;
      },
    );
  }

  function review() {
    note = "";
    isApprovalShort = false;
    reviewedFor = address;
    step = "review";
    readApproval();
  }

  /** A step of its own in the history: a phone's Back returns to the form. */
  function goToReview() {
    if (!$page.state?.routeReview) {
      pushState("", { routeReview: true });
    }

    review();
  }

  function leaveReview() {
    if ($page.state?.routeReview) {
      history.back();
    }

    step = "form";
  }

  /**
   * The step a phone's Back or Forward takes the history to: a review only of
   * what can still be reviewed.
   *
   * @param {boolean} isAtReview
   */
  function followHistory(isAtReview) {
    if (step === "review" && !isAtReview) {
      note = "";
      step = "form";
    } else if (step === "form" && isAtReview && primary?.ready && isConnected) {
      review();
    }
  }

  // What this screen sends, it sends for the wallet it was drawn for.
  const forThisWallet = walletStore.forThisWallet();

  /**
   * What stopped it, when that isn't a failure: refused in the wallet, or the
   * wallet on another account. Nothing moved, so it goes back a step.
   *
   * @param {unknown} error
   */
  function stoppedBy(error) {
    if (
      /** @type {{ code?: string }} */ (error)?.code === EVM_ACCOUNT_CHANGED
    ) {
      note = ACCOUNT_CHANGED_NOTE;
      leaveReview();

      return true;
    }

    if (error instanceof SendPasswordDeclinedError) {
      note = "It waits for your password, so nothing moved.";
      step = "review";
      readApproval();

      return true;
    }

    if (isDeclinedInWallet(error)) {
      note =
        sending === "approving"
          ? "You cancelled the allowance in your wallet. Nothing moved."
          : approved
            ? "You cancelled the migration in your wallet. Nothing moved."
            : "You cancelled the migration in your wallet. The allowance went through, so next time it only asks to migrate. Nothing moved.";
      step = "review";
      readApproval();

      return true;
    }

    return false;
  }

  /**
   * What a failure means. Once the migration was in the wallet's hands, it
   * went out, so it isn't said to have stopped before it was sent.
   *
   * @param {Error} error
   */
  function describeError(error) {
    const failedOnChain = error.message.includes("didn't go through");

    if (sending !== "confirming") {
      const said = describeFailure(error, {
        checkFirst:
          "Check your EVM wallet and Activity before you send it again.",
      });

      return failedOnChain
        ? { sentence: `${chainName} refused the allowance, so nothing moved.` }
        : isApprovalShort
          ? {
              sentence:
                "Your allowance no longer covers this amount. Nothing was sent.",
            }
          : // The approval it sent went through, and paid its fee there.
            said.unreachable && sending === "migrating" && !approved
            ? {
                ...said,
                sentence:
                  "Couldn't reach the network. The allowance went through, so next time it only asks to migrate. Nothing moved.",
              }
            : said;
    }

    return failedOnChain
      ? { sentence: `${chainName} refused it, so your tokens didn't move.` }
      : {
          heading: "Not confirmed",
          sentence: `It was sent to ${chainName}. Check Activity before you try again.`,
        };
  }

  function send() {
    const owner = /** @type {`0x${string}`} */ (address);

    // It goes out now, as far as a reload can tell: nothing brings it back.
    draft.clear();
    note = "";
    sending = "";
    operation = forThisWallet(sendMigration)({
      amountLux,
      onStep: (now) => {
        sending = now;
      },
      owner,
      recipient,
      route,
      stillHere,
    }).catch(async (error) => {
      if (stoppedBy(error)) {
        return "";
      }

      canGoBack =
        sending !== "confirming" && Boolean(describeFailure(error).canRetry);

      if (canGoBack) {
        draft.keep(toKeep);
      }

      // Why, where the chain can say: an approval used up since it was read.
      isApprovalShort =
        canGoBack &&
        sending === "migrating" &&
        !(await isApproved(route, owner, amountLux).catch(() => true));

      throw error;
    });
    step = "result";
  }

  function primaryAction() {
    if (!isConnected) {
      modal.open(route.chain.chainId);
    } else if (chainId !== route.chain.chainId) {
      askToSwitch(route.chain.chainId);
    } else if (primary.ready) {
      goToReview();
    }
  }

  // What's typed, kept as it's typed, for as long as it hasn't gone out.
  $: toKeep = { amount };
  $: if (step !== "result") {
    draft.save(toKeep);
  }

  // A flow the person started shows its figures, with balances hidden too.
  $: ({ language } = $settingsStore);
  // What the Sent screen says is on its way.
  $: sentWhat = `${formatDuskExact(amountLux, language)} DUSK`;
  $: ({ address, chainId, isConnected } = $account);
  $: follow(isConnected ? address : undefined, chainId);
  $: followHistory(Boolean($page.state?.routeReview));
  $: followRevokeHistory(Boolean($page.state?.routeRevoke));
  $: readOpenApproval(
    (step === "form" || step === "revoke") &&
      isConnected &&
      chainId === route.chain.chainId
      ? address
      : undefined,
  );
  $: hasOpenApproval = typeof openApproval === "bigint" && openApproval > 0n;
  // What Finish fills in: all the approval lets go, of what the wallet holds.
  $: finishLux =
    hasOpenApproval && balanceLux !== undefined
      ? /** @type {bigint} */ (openApproval) / WEI_PER_LUX < balanceLux
        ? /** @type {bigint} */ (openApproval) / WEI_PER_LUX
        : balanceLux
      : 0n;
  // What stays approved once the amount reviewed went, under an earlier approval.
  $: approvalLeft = reviewedApproval - amountLux * WEI_PER_LUX;
  $: chainName = route.chain.name;
  $: feeUnit = route.chain.currency.symbol;
  $: unit = route.chain.tokenLabel ?? "DUSK";
  $: amountLux = readDuskInput(amount, language) ?? 0n;
  $: problem = amountProblem(amount, language);
  $: balanceLux = balance === undefined ? undefined : balance / WEI_PER_LUX;
  $: time = routeTime(route, { net });
  $: timeText = routeTimeText(time);
  // An open approval that covers the amount leaves one step, as Review says.
  $: isCovered =
    hasOpenApproval &&
    amountLux > 0n &&
    /** @type {bigint} */ (openApproval) >= amountLux * WEI_PER_LUX;
  $: routeLine = [timeText, isCovered ? "" : "approve, then migrate"]
    .filter(Boolean)
    .join(" · ")
    .replace(/^./, (first) => first.toUpperCase());
  $: primary = !route.running
    ? { label: "Not running right now", ready: false }
    : !isConnected
      ? { label: "Connect an EVM wallet", ready: true }
      : chainId !== route.chain.chainId
        ? $isAskingToSwitch
          ? { label: `Switching to ${chainName}…`, ready: false }
          : { label: `Switch to ${chainName}`, ready: true }
        : balanceLux === undefined
          ? { label: "Checking the balance…", ready: false }
          : balanceLux === 0n
            ? { label: `No ${unit} on ${chainName}`, ready: false }
            : amount === ""
              ? { label: "Enter an amount", ready: false }
              : amountLux === 0n
                ? {
                    label: problem.includes("decimals")
                      ? "Use at most 9 decimals"
                      : "Check the amount",
                    ready: false,
                  }
                : amountLux > balanceLux
                  ? { label: `Not enough ${unit}`, ready: false }
                  : { label: "Review", ready: true };
  $: canType = route.running && isConnected && Boolean(balanceLux);
  // A review needs its wallet: without one, back to the form.
  $: if (step === "review" && !isConnected) {
    leaveReview();
  }
  // It's for one account: on another, it's reviewed again.
  $: if (step === "review" && isConnected && address !== reviewedFor) {
    note = ACCOUNT_CHANGED_NOTE;
    leaveReview();
  }
  // The same for a revoke's, unless it's on its way: what it ran into says.
  $: if (step === "revoke" && !revoking && !isConnected) {
    leaveRevokeReview();
  }
  $: if (
    step === "revoke" &&
    !revoking &&
    isConnected &&
    address !== reviewedFor
  ) {
    note = ACCOUNT_CHANGED_NOTE;
    leaveRevokeReview();
  }

  import "./routeReview.css";
</script>

<!-- What to check against the EVM wallet, for whoever does: the last row,
  closed. -->
{#snippet toCheck(/** @type {string} */ what, /** @type {string} */ where)}
  <details class="route-review__details">
    <summary>Details</summary>
    <dl class="route-review__rows">
      <div>
        <dt>Network</dt>
        <dd>{chainName}, chain ID {route.chain.chainId}</dd>
      </div>
      <div>
        <dt>Migration contract</dt>
        <dd><FullAddress address={route.contract} /></dd>
      </div>
      <div>
        <dt>Token</dt>
        <dd>
          <span class="route-review__name">{unit}</span>
          <FullAddress address={route.chain.token ?? ""} />
        </dd>
      </div>
    </dl>
    <p class="route-review__public"><b>{where}</b> {what}</p>
  </details>
{/snippet}

{#if step === "form"}
  {#if note}
    <p class="route-note" role="alert">{note}</p>
  {/if}
  {#if hasOpenApproval && openApproval !== undefined}
    <div class="route-approval">
      <p class="route-approval__title">Open allowance</p>
      <p>
        {#if openApproval >= NO_LIMIT}
          The migration contract may still take any amount of {unit} from this wallet.
        {:else}
          The migration contract may still take <BalanceValue
            hidden={false}
            value={approvalText(openApproval)}
          />
          {unit} from this wallet.
        {/if}
      </p>
      {#if revoking}
        <p role="status">
          {revoking === "signing"
            ? "Revoke in your wallet"
            : `Waiting for ${chainName}…`}
        </p>
      {:else}
        <div class="route-approval__actions">
          {#if finishLux > 0n}
            <Button
              on:click={finish}
              size="small"
              text="Finish"
              variant="secondary"
            />
          {/if}
          <Button
            on:click={goToRevokeReview}
            size="small"
            text="Revoke"
            variant="tertiary"
          />
        </div>
      {/if}
    </div>
  {/if}
  <div class="swap-panel">
    <div class="swap-panel__head">
      <span class="swap-panel__label">From</span>
      <NetworkPicker
        choices={fromChoices}
        on:pick={({ detail }) => dispatch("pick", { from: detail })}
        side="From"
        title="Where it comes from"
        value={route.origin}
      />
    </div>
    <div class="swap-amount">
      <label class="sr-only" for="migration-amount">Amount, in {unit}</label>
      <input
        aria-describedby="migration-balance-label migration-balance"
        aria-invalid={amount !== "" &&
          (amountLux === 0n || amountLux > (balanceLux ?? 0n))}
        autocomplete="off"
        disabled={!canType}
        id="migration-amount"
        inputmode="decimal"
        on:input={typeAmount}
        placeholder="0"
        spellcheck="false"
        type="text"
        style:--figure-width={figureWidth(amount || "0")}
        value={amount}
      />
      <span class="swap-token"><NetworkMark id={route.origin} />{unit}</span>
    </div>
    <div class="swap-foot">
      <span id="migration-balance-label">Balance:</span>
      <span class="swap-foot__value">
        <span id="migration-balance">
          {#if !isConnected}
            connect a wallet
          {:else if balanceLux === undefined}
            {$isAskingToSwitch ? "checking" : "switch network to see it"}
          {:else}
            <BalanceValue
              exact={formatDuskExact(balanceLux, language)}
              hidden={false}
              value={formatDusk(balanceLux, language)}
            />
            {unit}
          {/if}
        </span>
        <button
          class="swap-mini"
          disabled={!canType}
          on:click={() => {
            amount = amountForField(
              formatDuskPlain(balanceLux ?? 0n),
              getDecimalSeparator(language),
            );
          }}
          type="button">Max</button
        >
      </span>
    </div>
    {#if readAmount(amount, language).question}
      <!-- Either of two: a tap on one puts it in the field. -->
      <AmountQuestion
        className="swap-error"
        {language}
        on:choose={(event) => {
          note = "";
          amount = event.detail;
        }}
        text={amount}
      />
    {:else if problem}
      <p class="swap-error" role="alert">{problem}</p>
    {/if}
    {#if isConnected && chainId === route.chain.chainId && balanceLux === 0n}
      <!-- None of it here yet: the wallet can show it once there's some. -->
      <AddDusk chain={route.chain} />
    {/if}
    {#if isConnected && address}
      <p class="swap-recipient">
        from <b title={address}>{shortenAddress(address)}</b> ·
        <button
          aria-label={`${chainName} wallet ${address}: disconnect or change wallet`}
          class="swap-link"
          on:click={() => modal.open()}
          type="button">Change</button
        >
      </p>
    {/if}
  </div>

  <p class="route-amount-reason sr-only" role="status">
    {amount !== "" && !primary.ready ? primary.label : ""}
  </p>
  <div class="swap-flip">
    {#if canFlip}
      <button
        aria-label="Swap From and To"
        class="swap-flip__button"
        use:takeFocusIf={focusSwap}
        on:click={() => dispatch("flip")}
        type="button"><Icon path={mdiArrowDown} /></button
      >
    {:else}
      <span aria-hidden="true"><Icon path={mdiArrowDown} /></span>
    {/if}
  </div>

  <div class="swap-panel">
    <div class="swap-panel__head">
      <span class="swap-panel__label">To</span>
      <NetworkPicker
        choices={toChoices}
        on:pick={({ detail }) => dispatch("pick", { to: detail })}
        side="To"
        title="Where it goes"
        value={route.destination}
      />
    </div>
    <div class="swap-amount">
      <output
        aria-live="off"
        class:swap-amount__empty={amountLux === 0n}
        for="migration-amount"
        style:--figure-width={figureWidth(
          amountLux === 0n ? "0" : formatDuskExact(amountLux, language),
        )}
        >{amountLux === 0n ? "0" : formatDuskExact(amountLux, language)}</output
      >
      <span class="swap-token"><NetworkMark id="duskDs" />DUSK</span>
    </div>
    <div class="swap-foot"><span>You receive</span></div>
    <p class="swap-recipient">To your public balance</p>
  </div>

  <details class="swap-route">
    <summary
      ><Icon path={mdiClockOutline} /><span class="swap-route__sum"
        ><span>{route.running ? routeLine : notRunning(net)}</span
        ><RouteStatusLine {amountLux} {route} /></span
      ><Icon
        className="swap-route__chevron section-chevron"
        path={mdiChevronDown}
      /></summary
    >
    <dl>
      <div>
        <dt>Network fees</dt>
        <dd>On {chainName}, as your wallet shows. No bridge fee</dd>
      </div>
    </dl>
    <p class="swap-route__note">
      <b>Public on {chainName} and Dusk, and linked:</b> your {chainName} address,
      your public account and the amount.
    </p>
  </details>

  <div class="swap-cta">
    <Button
      disabled={!primary.ready}
      on:click={primaryAction}
      text={primary.label}
      variant="primary"
    />
  </div>
{:else if step === "review"}
  <!-- As Send's review: rows of what goes where and what it costs, one
    button, what can't be undone, then Back. -->
  <div class="route-review" use:focusHead>
    <SectionHead tabindex="-1">Review</SectionHead>
    {#if note}
      <p class="route-note" role="alert">{note}</p>
    {/if}
    <ReviewWallet />
    <dl class="route-review__rows">
      <div>
        <dt>Amount</dt>
        <dd>
          {formatDuskExact(amountLux, language)} DUSK
        </dd>
      </div>
      <div>
        <dt>From</dt>
        <dd>
          <span class="route-review__name">{chainName}</span>
          <FullAddress address={address ?? ""} />
        </dd>
      </div>
      <div>
        <dt>To</dt>
        <dd>
          <span class="route-review__name">Your public account</span>
          <FullAddress address={recipient} />
        </dd>
      </div>
      {#if approved === undefined}
        <div>
          <dt>Allowance</dt>
          <dd>Checking what the contract may take…</dd>
        </div>
      {:else if approved === false}
        <div>
          <dt>Allowance</dt>
          <dd>
            The migration contract may take exactly this amount. Nothing moves
            yet.
          </dd>
        </div>
      {:else if approved}
        <div>
          <dt>Allowance</dt>
          <dd>
            <span>
              {#if reviewedApproval >= NO_LIMIT}
                Covered by an unlimited allowance from before. It stays after
                this.
              {:else}
                Covered by an allowance of <BalanceValue
                  hidden={false}
                  value={approvalText(reviewedApproval)}
                />
                {unit} from before.
                {#if approvalLeft > 0n}
                  <BalanceValue
                    hidden={false}
                    value={approvalText(approvalLeft)}
                  />
                  {unit} stays after this.
                {:else}
                  None of it stays after this.
                {/if}
              {/if}
            </span>
          </dd>
        </div>
      {/if}
      <div>
        <dt>Fee</dt>
        <dd>
          {typeof feeBalance === "bigint"
            ? feeEstimate
              ? `About ${feeText(feeEstimate)} ${feeUnit} (you have ${feeText(feeBalance)} ${feeUnit}) · no bridge fee`
              : `You have ${feeText(feeBalance)} ${feeUnit} for it · no bridge fee`
            : `On ${chainName}, as your wallet shows · no bridge fee`}
        </dd>
      </div>
      {#if timeText}
        <div>
          <dt>Arrives</dt>
          <dd>in {timeText}</dd>
        </div>
      {/if}
    </dl>
    {@render toCheck(
      `your ${chainName} account, your public account and the amount.`,
      `Public on ${chainName} and Dusk, and linked:`,
    )}
    {#if feeBalance === 0n}
      <Button
        className="route-review__primary"
        disabled
        text={`No ${feeUnit} for the network fee`}
        variant="primary"
      />
    {:else if chainId === route.chain.chainId}
      <Button
        className="route-review__primary"
        confirm
        disabled={approved === undefined || !isConnected}
        icon={{ path: mdiArrowUpBoldBoxOutline, position: "before" }}
        on:click={send}
        text={`${approved === false ? "Approve" : "Migrate"} ${formatDuskExact(amountLux, language)} DUSK`}
        variant="primary"
      />
      {#if approved === false}
        <!-- Two wallet steps: this is the first, the migration the second. -->
        <p class="route-review__step">1 of 2</p>
      {/if}
      <p class="route-review__final">Can't be undone.</p>
    {:else}
      <Button
        className="route-review__primary"
        disabled={!primary.ready}
        on:click={primaryAction}
        text={primary.label}
        variant="primary"
      />
    {/if}
    <Button
      className="route-review__back"
      icon={{ path: mdiArrowLeft }}
      on:click={() => {
        note = "";
        leaveReview();
      }}
      text="Back"
      variant="secondary"
    />
  </div>
{:else if step === "revoke"}
  <div class="route-review" use:focusHead>
    <SectionHead tabindex="-1">Review</SectionHead>
    {#if note}
      <p class="route-note" role="alert">{note}</p>
    {/if}
    <ReviewWallet />
    <dl class="route-review__rows">
      <!-- Hidden with the balances, as the form before it hides it. -->
      <div>
        <dt>Allowance now</dt>
        <dd>
          {openApproval === undefined
            ? "…"
            : openApproval >= NO_LIMIT
              ? "Unlimited"
              : approvalText(openApproval)}
          {unit}
        </dd>
      </div>
      <div>
        <dt>From</dt>
        <dd>
          <span class="route-review__name">{chainName}</span>
          <FullAddress address={address ?? ""} />
        </dd>
      </div>
      <div>
        <dt>After it</dt>
        <dd>
          The migration contract can take no {unit} from this wallet. Nothing moves.
        </dd>
      </div>
      <div>
        <dt>Fee</dt>
        <dd>
          {typeof revokeFees.balance === "bigint"
            ? revokeFees.fee
              ? `About ${feeText(revokeFees.fee)} ${feeUnit} (you have ${feeText(revokeFees.balance)} ${feeUnit})`
              : `You have ${feeText(revokeFees.balance)} ${feeUnit} for it`
            : `On ${chainName}, as your wallet shows`}
        </dd>
      </div>
    </dl>
    {@render toCheck(
      `your ${chainName} account, and that it revokes its allowance.`,
      `Public on ${chainName}:`,
    )}
    {#if revoking}
      <p role="status">
        {revoking === "signing"
          ? "Revoke in your wallet"
          : `Waiting for ${chainName}…`}
      </p>
    {/if}
    {#if revokeFees.balance === 0n}
      <Button
        className="route-review__primary"
        disabled
        text={`No ${feeUnit} for the network fee`}
        variant="primary"
      />
    {:else if chainId === route.chain.chainId}
      <Button
        className="route-review__primary"
        confirm
        disabled={Boolean(revoking) || !isConnected}
        on:click={revoke}
        text="Revoke in your wallet"
        variant="primary"
      />
    {:else}
      <Button
        className="route-review__primary"
        disabled={$isAskingToSwitch}
        on:click={() => askToSwitch(route.chain.chainId)}
        text={$isAskingToSwitch
          ? `Switching to ${chainName}…`
          : `Switch to ${chainName}`}
        variant="primary"
      />
    {/if}
    <Button
      className="route-review__back"
      icon={{ path: mdiArrowLeft }}
      on:click={() => {
        note = "";
        leaveRevokeReview();
      }}
      text="Back"
      variant="secondary"
    />
  </div>
{:else}
  <div class="route-result" role="status" tabindex="-1" use:takeFocus>
    <OperationResult
      {describeError}
      errorMessage="The migration didn't go through"
      {operation}
      pendingMessage={sending === "approving"
        ? "Approve in your wallet (1 of 2)"
        : sending === "confirming"
          ? `Waiting for ${chainName}…`
          : approved === false
            ? "Migrate in your wallet (2 of 2)"
            : "Migrate in your wallet"}
      successMessage={sentHeading}
    >
      <svelte:fragment slot="success-content" let:result={hash}>
        <RouteTransferResult
          bind:heading={sentHeading}
          {hash}
          {route}
          sentText={timeText
            ? `${sentWhat} arrives on Dusk in ${timeText}.`
            : `${sentWhat} arrives on Dusk once the bridge pays it out.`}
          {time}
        />
      </svelte:fragment>
      <svelte:fragment slot="error-actions">
        {#if canGoBack}
          <Button
            on:click={review}
            text={isApprovalShort ? "Approve again" : "Try again"}
            variant="primary"
          />
        {/if}
      </svelte:fragment>
    </OperationResult>
  </div>
{/if}

<style lang="postcss">
  .route-result {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    padding: 0.5rem;
  }

  .route-result:focus {
    outline: none;
  }

  .route-note {
    margin: 0 0 0.75em;
    font-size: 0.875em;
    color: var(--on-surface-color);
  }

  /* An approval not used up: a fact about the wallet, above the form. */
  .route-approval {
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
    margin-bottom: 0.5rem;
    padding: 0.75rem 0.875rem;
    border: 1px solid var(--calm-line);
    border-radius: 0.75rem;
    font-size: 0.875rem;
  }

  .route-approval__title {
    font-weight: 500;
  }

  .route-approval__actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    margin-top: 0.25rem;
  }
</style>
