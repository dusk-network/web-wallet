<svelte:options immutable={true} />

<script>
  /**
   * The Bridge card on a migration into Dusk, from BNB Smart Chain or
   * Ethereum: the connected EVM wallet, on the route's chain, pays the
   * route's migration contract, which the route's payout account pays out
   * on Dusk to this profile's public account.
   */
  import { createEventDispatcher } from "svelte";
  import {
    mdiArrowDown,
    mdiArrowLeft,
    mdiArrowUpBoldBoxOutline,
    mdiChevronDown,
    mdiClockOutline,
  } from "@mdi/js";

  import { Button, Icon } from "$lib/dusk/components";
  import {
    formatDusk,
    formatDuskExact,
    formatDuskPlain,
  } from "$lib/dusk/currency";
  import { getDecimalSeparator } from "$lib/dusk/number";
  import { shortenAddress } from "$lib/dusk/string";
  import { settingsStore, walletStore } from "$lib/stores";
  import { account, modal } from "$lib/web3/walletConnection";
  import { getBalanceOfCoin } from "$lib/web3/migration";
  import { notRunning } from "$lib/bridge/cardRoutes";
  import { isApproved, sendMigration } from "$lib/bridge/routeFlows";
  import { routeTime, routeTimeText } from "$lib/bridge/routeTimes";

  import AppAnchorButton from "../AppAnchorButton/AppAnchorButton.svelte";
  import BalanceValue from "../BalanceValue/BalanceValue.svelte";
  import NetworkMark from "../NetworkPicker/NetworkMark.svelte";
  import NetworkPicker from "../NetworkPicker/NetworkPicker.svelte";
  import OperationResult from "../OperationResult/OperationResult.svelte";
  import ReviewAmount from "../ReviewAmount/ReviewAmount.svelte";
  import ReviewWallet from "../ReviewWallet/ReviewWallet.svelte";
  import { normalizeDuskInput, parseDuskInput } from "../Stake/stakeAmount";

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

  /** @type {string} */
  let amount = "";

  /** The token's balance in the wallet, in wei, once read. */
  /** @type {bigint | undefined} */
  let balance;

  /** Whether the contract may take the amount without an approval first. */
  /** @type {boolean | undefined} */
  let approved;

  /** @type {"form" | "result" | "review"} */
  let step = "form";

  /** Where a migration that was sent is. */
  /** @type {"" | "approving" | "confirming" | "migrating"} */
  let sending = "";

  /** @type {Promise<string>} */
  let operation = Promise.resolve("");

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
      chainId
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
      }
    );
  }

  function review() {
    approved = undefined;
    step = "review";
    isApproved(route, /** @type {`0x${string}`} */ (address), amountLux).then(
      (yes) => {
        approved = yes;
      },
      () => {
        approved = false;
      }
    );
  }

  // What this screen sends, it sends for the wallet it was drawn for.
  const forThisWallet = walletStore.forThisWallet();

  function send() {
    operation = forThisWallet(sendMigration)({
      amountLux,
      onStep: (now) => {
        sending = now;
      },
      owner: /** @type {`0x${string}`} */ (address),
      recipient,
      route,
    });
    step = "result";
  }

  function primaryAction() {
    if (!isConnected) {
      modal.open();
    } else if (primary.ready) {
      review();
    }
  }

  $: ({ language } = $settingsStore);
  $: ({ address, chainId, isConnected } = $account);
  $: follow(isConnected ? address : undefined, chainId);
  $: chainName = route.chain.name;
  $: unit = route.chain.tokenLabel ?? "DUSK";
  $: typed = normalizeDuskInput(amount, getDecimalSeparator());
  $: amountLux = parseDuskInput(typed) ?? 0n;
  $: balanceLux = balance === undefined ? undefined : balance / WEI_PER_LUX;
  $: time = routeTime(route, { net });
  $: timeText = routeTimeText(time);
  $: routeLine = [
    timeText,
    `approve, then migrate, in your ${chainName} wallet`,
  ]
    .filter(Boolean)
    .join(" · ")
    .replace(/^./, (first) => first.toUpperCase());
  $: primary = !route.running
    ? { label: "Not running right now", ready: false }
    : !isConnected
      ? { label: "Connect an EVM wallet", ready: true }
      : chainId !== route.chain.chainId
        ? { label: `Switching to ${chainName}…`, ready: false }
        : balanceLux === undefined
          ? { label: "Checking the balance…", ready: false }
          : balanceLux === 0n
            ? { label: `No ${unit} on ${chainName}`, ready: false }
            : amount === ""
              ? { label: "Enter an amount", ready: false }
              : amountLux === 0n
                ? { label: "Check the amount", ready: false }
                : amountLux > balanceLux
                  ? { label: `Not enough ${unit}`, ready: false }
                  : { label: "Review migration", ready: true };
  $: canType = route.running && isConnected && Boolean(balanceLux);
  // A review needs its wallet: without one, back to the form.
  $: if (step === "review" && !isConnected) {
    step = "form";
  }
</script>

{#if step === "form"}
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
        bind:value={amount}
        disabled={!canType}
        id="migration-amount"
        inputmode="decimal"
        placeholder="0"
        spellcheck="false"
        type="text"
      />
      <span class="swap-token"><NetworkMark id={route.origin} />{unit}</span>
    </div>
    <div class="swap-foot">
      <span id="migration-balance-label">Balance on {chainName}:</span>
      <span class="swap-foot__value">
        <span id="migration-balance">
          {#if !isConnected}
            connect a wallet to see it
          {:else if balanceLux === undefined}
            checking
          {:else}
            <BalanceValue
              exact={formatDuskExact(balanceLux, language)}
              value={formatDusk(balanceLux, language)}
            />
            {unit}
          {/if}
        </span>
        <button
          class="swap-mini"
          disabled={!canType}
          on:click={() => {
            amount = formatDuskPlain(balanceLux ?? 0n).replace(
              ".",
              getDecimalSeparator()
            );
          }}
          type="button">Max</button
        >
      </span>
    </div>
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

  <div class="swap-flip">
    {#if canFlip}
      <button
        aria-label="Swap From and To"
        class="swap-flip__button"
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
      <output class:swap-amount__empty={amountLux === 0n} for="migration-amount"
        >{amountLux === 0n ? "0" : formatDuskExact(amountLux, language)}</output
      >
      <span class="swap-token"><NetworkMark id="duskDs" />DUSK</span>
    </div>
    <div class="swap-foot"><span>You receive</span></div>
    <p class="swap-recipient">to your public balance on Dusk</p>
  </div>

  <details class="swap-route">
    <summary
      ><Icon path={mdiClockOutline} /><span
        >{route.running ? routeLine : notRunning(net)}</span
      ><Icon className="swap-route__chevron" path={mdiChevronDown} /></summary
    >
    <dl>
      <div>
        <dt>Steps</dt>
        <dd>Approve, if needed, then migrate, in your {chainName} wallet</dd>
      </div>
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
  <div class="route-review">
    <h2 class="route-review__title">Review</h2>
    <ReviewWallet />
    <ReviewAmount label="Amount" value={formatDuskExact(amountLux, language)} />
    <dl class="route-review__ends">
      <div>
        <dt>From</dt>
        <dd>
          <span>{chainName}</span>
          <span class="route-review__address">{address}</span>
        </dd>
      </div>
      <div>
        <dt>To</dt>
        <dd>
          <span>Your public account on Dusk</span>
          <span class="route-review__address">{recipient}</span>
        </dd>
      </div>
      <div>
        <dt>Steps</dt>
        <dd>
          {approved === undefined
            ? "Checking what the contract may take…"
            : approved
              ? "Migrate, in your wallet"
              : "Approve the amount, then migrate, in your wallet"}
        </dd>
      </div>
      <div>
        <dt>Network fees</dt>
        <dd>On {chainName}, as your wallet shows</dd>
      </div>
      {#if timeText}
        <div>
          <dt>Arrives</dt>
          <dd>On Dusk in {timeText}</dd>
        </div>
      {/if}
    </dl>
    <div class="route-review__actions">
      <Button
        icon={{ path: mdiArrowLeft }}
        on:click={() => {
          step = "form";
        }}
        text="Back"
        variant="secondary"
      />
      <Button
        disabled={approved === undefined || !isConnected}
        icon={{ path: mdiArrowUpBoldBoxOutline, position: "before" }}
        on:click={send}
        text="Migrate"
        variant="primary"
      />
    </div>
  </div>
{:else}
  <div class="route-result">
    <OperationResult
      errorMessage="The migration didn't go through"
      {operation}
      pendingMessage={sending === "approving"
        ? "Approve the amount in your wallet"
        : sending === "confirming"
          ? `Waiting for ${chainName}…`
          : "Migrate in your wallet"}
      successMessage="Migration sent"
    >
      <svelte:fragment slot="success-content" let:result={hash}>
        <p>
          {timeText
            ? `It arrives on Dusk in ${timeText}.`
            : "It arrives on Dusk once the bridge pays it out."}
        </p>
        <AppAnchorButton
          href={`/dashboard/bridge/transactions?tx=${hash}`}
          text="Track in activity"
          variant="tertiary"
        />
      </svelte:fragment>
    </OperationResult>
  </div>
{/if}

<style lang="postcss">
  .route-review,
  .route-result {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    padding: 0.5rem;
  }

  .route-review__title {
    margin: 0;
    font-size: 1.125rem;
    font-weight: 600;
  }

  .route-review__ends {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    margin: 0;

    & > div {
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
    }

    & dt {
      color: var(--calm-muted);
      font-size: 0.8125rem;
    }

    & dd {
      display: flex;
      flex-direction: column;
      gap: 0.125rem;
      margin: 0;
    }
  }

  .route-review__address {
    color: var(--calm-muted);
    font-family: var(--mono-font-family, monospace);
    font-size: 0.8125rem;
    overflow-wrap: anywhere;
  }

  .route-review__actions {
    display: grid;
    grid-template-columns: 1fr 2fr;
    gap: 0.5rem;
    margin-top: 0.25rem;
  }
</style>
