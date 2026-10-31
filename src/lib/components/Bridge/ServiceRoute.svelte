<svelte:options immutable={true} />

<script>
  /**
   * The Bridge card on a transfer out to another chain, as BNB Smart Chain:
   * a public transfer to the route's account, which pays the amount less its
   * fee to the connected EVM wallet's address there. The address comes from
   * the wallet, never typed.
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
    formatFee,
    formatTotal,
  } from "$lib/dusk/currency";
  import { getDecimalSeparator } from "$lib/dusk/number";
  import { shortenAddress } from "$lib/dusk/string";
  import { areValidGasSettings, followDefaultGas } from "$lib/contracts";
  import { settingsStore, walletStore } from "$lib/stores";
  import { account, modal } from "$lib/web3/walletConnection";
  import { notRunning } from "$lib/bridge/cardRoutes";
  import { sendServiceTransfer, serviceLine } from "$lib/bridge/routeFlows";
  import { routeTime, routeTimeText } from "$lib/bridge/routeTimes";

  import AppAnchorButton from "../AppAnchorButton/AppAnchorButton.svelte";
  import BalanceValue from "../BalanceValue/BalanceValue.svelte";
  import GasSettings from "../GasSettings/GasSettings.svelte";
  import NetworkMark from "../NetworkPicker/NetworkMark.svelte";
  import NetworkPicker from "../NetworkPicker/NetworkPicker.svelte";
  import OperationResult from "../OperationResult/OperationResult.svelte";
  import ReviewAmount from "../ReviewAmount/ReviewAmount.svelte";
  import ReviewWallet from "../ReviewWallet/ReviewWallet.svelte";
  import { normalizeDuskInput, parseDuskInput } from "../Stake/stakeAmount";

  /** @type {import("$lib/bridge/cardRoutes").CardRoute & { kind: "service" }} */
  export let route;

  /** @type {import("$lib/bridge/cardRoutes").CardChoice[]} */
  export let fromChoices;

  /** @type {import("$lib/bridge/cardRoutes").CardChoice[]} */
  export let toChoices;

  /** Whether the flip has a way back to go to. */
  export let canFlip = false;

  /** @type {import("@dusk-network/networks").Network | null} */
  export let net = null;

  /** The public account it's sent from, and what it holds. */
  /** @type {string} */
  export let unshieldedAddress;

  /** @type {bigint} */
  export let unshieldedBalance;

  /** A public transfer's gas, as the wallet starts it. */
  /** @type {ContractGasSettings} */
  export let gasSettings;

  /** @type {GasStoreContent} */
  export let gasLimits;

  const dispatch = createEventDispatcher();

  /** @type {string} */
  let amount = "";

  let { gasLimit, gasPrice } = gasSettings;
  let defaultGas = gasSettings;

  /** @type {"form" | "result" | "review"} */
  let step = "form";

  /** @type {Promise<string>} */
  let operation = Promise.resolve("");

  // What this screen sends, it sends from the wallet it was drawn for.
  const forThisWallet = walletStore.forThisWallet();

  function send() {
    operation = forThisWallet(sendServiceTransfer)({
      amountLux,
      gasLimit,
      gasPrice,
      recipient: /** @type {`0x${string}`} */ (address),
      route,
    });
    step = "result";
  }

  function primaryAction() {
    if (!isConnected) {
      modal.open();
    } else if (primary.ready) {
      step = "review";
    }
  }

  $: ({ language } = $settingsStore);
  $: ({ address, isConnected } = $account);
  $: chainName = route.chain.name;
  $: amountLux =
    parseDuskInput(normalizeDuskInput(amount, getDecimalSeparator())) ?? 0n;
  $: fee = gasLimit * gasPrice;
  $: total = amountLux + fee;
  $: arrivesLux = amountLux > route.feeLux ? amountLux - route.feeLux : 0n;
  $: isGasValid = areValidGasSettings(gasPrice, gasLimit, gasLimits);
  $: timeText = routeTimeText(routeTime(route, { net }));

  // The node's price can arrive while the form is open: the form takes it,
  // unless the gas was edited here, and keeps the gas a review shows.
  $: if (step === "form" && gasSettings !== defaultGas) {
    ({ gasLimit, gasPrice } = followDefaultGas(
      { gasLimit, gasPrice },
      defaultGas,
      gasSettings
    ));
    defaultGas = gasSettings;
  }

  $: primary = !route.running
    ? { label: "Not running right now", ready: false }
    : !isConnected
      ? { label: "Connect an EVM wallet", ready: true }
      : amountLux === 0n
        ? {
            label: amount ? "Check the amount" : "Enter an amount",
            ready: false,
          }
        : amountLux <= route.feeLux
          ? {
              label: `Send more than the ${formatDuskExact(route.feeLux, language)} DUSK bridge fee`,
              ready: false,
            }
          : total > unshieldedBalance
            ? { label: "Not enough DUSK", ready: false }
            : !isGasValid
              ? { label: "Check the network fee", ready: false }
              : { label: "Review bridge", ready: true };
  // A review needs the address it pays: without a wallet, back to the form.
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
      <label class="sr-only" for="service-amount">Amount, in DUSK</label>
      <input
        aria-describedby="service-balance-label service-balance"
        aria-invalid={amount !== "" && amountLux === 0n}
        autocomplete="off"
        bind:value={amount}
        disabled={!route.running}
        id="service-amount"
        inputmode="decimal"
        placeholder="0"
        spellcheck="false"
        type="text"
      />
      <span class="swap-token"><NetworkMark id="duskDs" />DUSK</span>
    </div>
    <div class="swap-foot">
      <span id="service-balance-label">Public balance:</span>
      <span class="swap-foot__value">
        <span id="service-balance"
          ><BalanceValue
            exact={formatDuskExact(unshieldedBalance, language)}
            value={formatDusk(unshieldedBalance, language)}
          /> DUSK</span
        >
        <button
          class="swap-mini"
          disabled={!route.running || unshieldedBalance <= fee}
          on:click={() => {
            amount = formatDuskPlain(unshieldedBalance - fee).replace(
              ".",
              getDecimalSeparator()
            );
          }}
          type="button">Max</button
        >
      </span>
    </div>
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
      <output class:swap-amount__empty={arrivesLux === 0n} for="service-amount"
        >{arrivesLux === 0n
          ? "0"
          : formatDuskExact(arrivesLux, language)}</output
      >
      <span class="swap-token"
        ><NetworkMark id={route.destination} />{route.chain.tokenLabel ??
          "DUSK"}</span
      >
    </div>
    <div class="swap-foot">
      <span>You receive, less the bridge's fee</span>
    </div>
    {#if isConnected && address}
      <p class="swap-recipient">
        to your {chainName} address
        <b title={address}>{shortenAddress(address)}</b>
        ·
        <button
          aria-label={`${chainName} address ${address}: disconnect or change wallet`}
          class="swap-link"
          on:click={() => modal.open()}
          type="button">Change</button
        >
      </p>
    {:else}
      <p class="swap-recipient">to the address of the EVM wallet you connect</p>
    {/if}
  </div>

  <details class="swap-route">
    <summary
      ><Icon path={mdiClockOutline} /><span
        >{route.running
          ? [
              timeText,
              `${formatDuskExact(route.feeLux, language)} DUSK bridge fee`,
            ]
              .filter(Boolean)
              .join(" · ")
          : notRunning(net)}</span
      ><Icon className="swap-route__chevron" path={mdiChevronDown} /></summary
    >
    <dl>
      <div>
        <dt>Steps</dt>
        <dd>One, in this wallet</dd>
      </div>
      <div>
        <dt>Bridge fee</dt>
        <dd>
          {formatDuskExact(route.feeLux, language)} DUSK, from the amount
        </dd>
      </div>
      <div>
        <dt>Leaves your public balance</dt>
        <dd>up to {formatFee(total, language, { max: true })} DUSK</dd>
      </div>
    </dl>
    <div class="route-gas">
      <GasSettings
        {fee}
        limit={gasLimit}
        limitLower={gasLimits.gasLimitLower}
        limitUpper={gasLimits.gasLimitUpper}
        price={gasPrice}
        priceLower={gasLimits.gasPriceLower}
        on:gasSettings={(event) => {
          gasPrice = event.detail.price;
          gasLimit = event.detail.limit;
        }}
      />
    </div>
    <p class="swap-route__note">
      <b>Public on Dusk and {chainName}, and linked:</b> your public account,
      your
      {chainName} address and the amount.
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
    <p class="route-review__line">
      {serviceLine(
        { chain: chainName, feeLux: route.feeLux, sentLux: amountLux },
        language
      )}
    </p>
    {#if timeText}
      <p class="route-review__time">
        It usually arrives in {timeText.replace(/^~/, "about ")}.
      </p>
    {/if}
    <dl class="route-review__ends">
      <div>
        <dt>From</dt>
        <dd>
          <span>Your public account on Dusk</span>
          <span class="route-review__address">{unshieldedAddress}</span>
        </dd>
      </div>
      <div>
        <dt>To</dt>
        <dd>
          <span>Your {chainName} address</span>
          <span class="route-review__address">{address}</span>
        </dd>
      </div>
    </dl>
    <ReviewAmount
      label="Network fee (at most)"
      value={formatFee(fee, language, { max: true })}
    />
    <ReviewAmount
      label="Total (at most)"
      value={formatTotal(total, unshieldedBalance, language)}
    />
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
        disabled={arrivesLux === 0n || !isConnected || !isGasValid}
        icon={{ path: mdiArrowUpBoldBoxOutline, position: "before" }}
        on:click={send}
        text="Send"
        variant="primary"
      />
    </div>
  </div>
{:else}
  <div class="route-result">
    <OperationResult
      errorMessage="The transfer didn't go through"
      {operation}
      pendingMessage="Sending…"
      successMessage="Sent"
    >
      <svelte:fragment slot="success-content" let:result={hash}>
        <p>
          {timeText
            ? `It usually arrives on ${chainName} in ${timeText.replace(/^~/, "about ")}.`
            : `It arrives on ${chainName} once the bridge pays it out.`}
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
  .route-gas {
    margin: 0 0.5rem 0.5rem;
  }

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

  .route-review__line {
    margin: 0;
    font-weight: 500;
    line-height: 1.45;
  }

  .route-review__time {
    margin: 0;
    color: var(--calm-muted);
    font-size: 0.875rem;
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
