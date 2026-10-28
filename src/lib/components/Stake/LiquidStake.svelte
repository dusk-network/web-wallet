<svelte:options immutable={true} />

<script>
  import { onDestroy, onMount, tick } from "svelte";
  import { get } from "svelte/store";
  import {
    mdiAlertCircleOutline,
    mdiContentCopy,
    mdiFileDocumentOutline,
    mdiPercentOutline,
    mdiWaterOutline,
  } from "@mdi/js";

  import { areValidGasSettings, followDefaultGas } from "$lib/contracts";
  import {
    formatDusk,
    formatDuskExact,
    formatDuskPlain,
    formatTotal,
  } from "$lib/dusk/currency";
  import { randomUUID, shortenAddress } from "$lib/dusk/string";
  import { Button, Icon, Textbox } from "$lib/dusk/components";
  import { toast } from "$lib/dusk/components/Toast/store";
  import { SOZU_URL } from "$lib/sozu/config";
  import {
    feePercent,
    leastSozuStake,
    sozuFee,
    sozuStake,
  } from "$lib/sozu/amounts";
  import { networkStore, settingsStore, walletStore } from "$lib/stores";

  import BalanceValue from "../BalanceValue/BalanceValue.svelte";
  import GasSettings from "../GasSettings/GasSettings.svelte";
  import TransactionResult from "../TransactionResult/TransactionResult.svelte";
  import StakeFlow from "./StakeFlow.svelte";
  import { checkAmount, parseDuskInput } from "./stakeAmount";

  /**
   * Liquid staking through Sozu, a third party: what the account has with
   * Sozu, the amount to stake or unstake, checked as it is typed, and a
   * summary with the button that sends it.
   */

  /** @type {(action: "stake" | "unstake", poolId: string, amount: bigint, gasPrice: bigint, gasLimit: bigint) => Promise<string>} */
  export let execute;

  /** The public balance, which pays a stake and every fee. */
  /** @type {bigint} */
  export let availableBalance;

  /** What was read from Sozu. */
  /** @type {{ error: Error | null, loading: boolean, status: SozuStatus | null }} */
  export let sozu;

  /** @type {"stake" | "unstake"} */
  export let action = "stake";

  /**
   * The gas each action starts from, at the node's price, and its bounds: a
   * stake's, and an unstake's, which can touch more of Sozu's provisioners.
   *
   * @type {Record<"stake" | "unstake", { limits: GasStoreContent, settings: ContractGasSettings }>}
   */
  export let gas;

  /** @type {() => void} */
  export let onRetry = () => {};

  /**
   * Reads Sozu again, as just before a stake is sent: the status now, or
   * null when it couldn't be read.
   *
   * @type {() => Promise<SozuStatus | null>}
   */
  export let recheck;

  const id = randomUUID();

  /** @type {("stake" | "unstake")[]} */
  const TABS = ["stake", "unstake"];

  /** The amount typed, and the one typed for the other action. */
  let amountText = "";
  let otherText = "";
  let isReviewing = false;
  let { gasLimit, gasPrice } = gas[action].settings;
  let defaultGas = gas[action].settings;
  let isGasValid = false;

  /** @type {{ maxFee: bigint, operation: Promise<string>, what: string } | null} */
  let sent = null;

  /** A fee so high that no stake gets stDUSK: 100%, or so near it that the least is past any amount. */
  const NO_STAKE = "No stake gets stDUSK at Sozu's deposit fee now.";

  /** Sozu's terms, read again as the stake was sent, had changed: nothing was sent. */
  let termsChanged = false;

  /** They couldn't be read again: nothing was sent. */
  let termsError = "";
  let isChecking = false;

  /**
   * Counts what the summary showed being left or changed: a stake whose
   * terms are read meanwhile isn't sent.
   */
  let draftEpoch = 0;
  let isGone = false;

  /** @param {"stake" | "unstake"} next */
  async function pick(next) {
    if (next !== action) {
      forgetTerms();
      [amountText, otherText] = [otherText, amountText];
      action = next;
    }

    await tick();
    document.getElementById(`${id}-tab-${next}`)?.focus();
  }

  /**
   * The arrow keys move between the tabs, as in a tab list.
   *
   * @param {KeyboardEvent} event
   */
  function handleTabKey(event) {
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      pick(action === "stake" ? "unstake" : "stake");
    }
  }

  /** @param {bigint} lux */
  function fill(lux) {
    forgetTerms();
    amountText = formatDuskPlain(lux);
    document.getElementById(`${id}-amount`)?.focus();
  }

  async function copyContract() {
    try {
      await navigator.clipboard.writeText(status?.contracts.pool ?? "");
      toast("success", "Contract ID copied", mdiContentCopy);
    } catch {
      toast("error", "Couldn't copy the contract ID", mdiAlertCircleOutline);
    }
  }

  /**
   * What the summary shows of Sozu's terms for a stake of `lux`: the deposit
   * fee and its rate, about how much stDUSK it gets, and whether it goes
   * ahead.
   *
   * @param {bigint} lux
   * @param {SozuStatus | null} terms
   */
  function shownTerms(lux, terms) {
    const rate = terms?.fees?.deposit ?? null;
    const quote = sozuStake(lux, terms?.pool ?? null, rate);

    return [
      rate
        ? `${feePercent(rate, language)} · ${formatDuskExact(quote.fee, language)}`
        : "",
      quote.stDusk === null ? "" : formatDusk(quote.stDusk, language),
      quote.ok,
    ].join(" | ");
  }

  /**
   * Sozu's terms for a stake as they are now, read again just before it's
   * sent: its pool takes the fee of that moment, and Sozu can change it, or
   * pause deposits, at any time.
   *
   * @param {bigint} lux
   * @param {SozuStatus} shown The status the summary showed
   * @returns {Promise<SozuStatus | "changed" | "unread">} The status now,
   *   when nothing the summary shows changed and deposits are open
   */
  async function recheckStake(lux, shown) {
    const now = await recheck().catch(() => null);

    if (!now) {
      return "unread";
    }

    const changed =
      shownTerms(lux, shown) !== shownTerms(lux, now) ||
      now.contracts.pool !== shown.contracts.pool ||
      now.flags?.maintenance !== false ||
      (shown.flags?.synchronization !== true &&
        now.flags?.synchronization === true);

    return changed ? "changed" : now;
  }

  /** The network and the profile a stake goes from. */
  const whereFrom = () => ({
    network: String(get(networkStore).networkName ?? ""),
    profile: String(get(walletStore).currentProfile?.account ?? ""),
  });

  /**
   * Whether the stake about to be sent is still the one the summary shows:
   * the page still open, its amount, action and gas as they were, and the
   * same network and profile.
   *
   * @param {{ action: "stake" | "unstake", epoch: number, lux: bigint, network: string, profile: string }} order
   */
  function isStillShown(order) {
    const from = whereFrom();

    return (
      !isGone &&
      draftEpoch === order.epoch &&
      amount === order.lux &&
      action === order.action &&
      from.network === order.network &&
      from.profile === order.profile
    );
  }

  /**
   * Reads Sozu's terms again for the stake about to be sent: the pool to
   * send it to, or null when nothing goes, as the terms changed, couldn't be
   * read, or what the summary showed was left or changed meanwhile.
   *
   * @param {{ action: "stake" | "unstake", epoch: number, lux: bigint, network: string, profile: string }} order
   * @param {SozuStatus} shown The status the summary showed
   * @returns {Promise<string | null>}
   */
  async function termsNow(order, shown) {
    isChecking = true;
    termsError = "";

    const terms = await recheckStake(order.lux, shown);

    isChecking = false;

    if (!isStillShown(order)) {
      return null;
    }

    termsChanged = terms === "changed";
    termsError =
      terms === "unread" ? "Couldn't check Sozu's terms just now" : "";

    return typeof terms === "string" ? null : terms.contracts.pool;
  }

  async function send() {
    if (!status || amount === null || !canSend || isChecking) {
      return;
    }

    const order = {
      action,
      epoch: draftEpoch,
      gasLimit,
      gasPrice,
      lux: amount,
      maxFee: maxGasFee,
      ...whereFrom(),
    };
    // A stake goes ahead on Sozu's terms as they are when it's sent: read
    // them again first, and if anything the summary shows changed, show the
    // new figures for another confirmation instead.
    const pool =
      order.action === "stake"
        ? await termsNow(order, status)
        : status.contracts.pool;

    if (pool) {
      sent = {
        maxFee: order.maxFee,
        operation: execute(
          order.action,
          pool,
          order.lux,
          order.gasPrice,
          order.gasLimit
        ),
        what:
          order.action === "stake"
            ? `${formatDuskExact(order.lux, language)} DUSK to Sozu`
            : `${formatDuskExact(order.lux, language)} DUSK unstaked from Sozu`,
      };
    }
  }

  /**
   * What the summary shows follows the amount, the action and the gas
   * again: a stake whose terms are being read isn't sent.
   */
  function forgetTerms() {
    termsChanged = false;
    termsError = "";
    draftEpoch += 1;
  }

  onMount(() => {
    isGasValid = areValidGasSettings(gasPrice, gasLimit, gasLimits);
  });

  onDestroy(() => {
    isGone = true;
  });

  // Each action's own gas: a tab's, or the node's price once it's read,
  // unless the gas was edited.
  $: ({ limits: gasLimits, settings: gasSettings } = gas[action]);
  $: if (!sent && !isReviewing && gasSettings !== defaultGas) {
    ({ gasLimit, gasPrice } = followDefaultGas(
      { gasLimit, gasPrice },
      defaultGas,
      gasSettings
    ));
    defaultGas = gasSettings;
    isGasValid = areValidGasSettings(gasPrice, gasLimit, gasLimits);
  }

  $: ({ language } = $settingsStore);
  $: ({ status } = sozu);
  // Sozu's switches, each on its own: no deposits while it's under
  // maintenance, or while that can't be checked, and calls that can fail
  // while it synchronizes.
  $: maintenance = status?.flags?.maintenance;
  $: isPaused = isStake && maintenance === true;
  $: isUnchecked =
    isStake && Boolean(status) && maintenance !== true && maintenance !== false;
  $: isStakeOff = isPaused || isUnchecked;
  $: isSyncing = status?.flags?.synchronization === true;
  $: fees = status?.fees ?? null;
  $: isStake = action === "stake";
  $: maxGasFee = gasLimit * gasPrice;
  $: staked = status?.position.balance ?? 0n;
  // Sozu's deposit fee, as its substrate gives it, where it could be read.
  $: depositRate = status?.fees?.deposit ?? null;
  $: stDusk = status?.position.stDusk ?? 0n;
  $: most = isStake
    ? availableBalance > maxGasFee
      ? availableBalance - maxGasFee
      : 0n
    : staked;
  $: amount = parseDuskInput(amountText);
  // Less than this gets no stDUSK at the rate now, after the fee; with none,
  // no stake does.
  $: least = isStake ? leastSozuStake(status?.pool ?? null, depositRate) : 0n;
  $: checked = checkAmount({
    amount,
    available: availableBalance,
    fee: maxGasFee,
    locale: language,
    minimum: least ?? 0n,
    most: isStake
      ? undefined
      : {
          amount: staked,
          error: "That's more than you have staked with Sozu.",
        },
    text: amountText,
  });
  $: check =
    least === null && checked.ok
      ? { error: NO_STAKE, isMinimum: true, ok: false }
      : checked;
  $: canSend = Boolean(status) && check.ok && isGasValid && !isStakeOff;
  $: shownAmount = amount !== null && check.ok ? amount : 0n;
  // What is typed shows in the summary, muted while it can't be sent.
  $: typedAmount = amount ?? 0n;
  $: depositFee = depositRate ? sozuFee(typedAmount, depositRate) : null;
  // What the stake gets, for what's left once Sozu takes its fee, and what
  // that's worth now.
  $: stake = sozuStake(shownAmount, status?.pool ?? null, depositRate);
  $: estimate = isStake && check.ok ? stake.stDusk : null;
  $: isTypedOff = Boolean(check.error);
  $: total = isStake ? typedAmount + maxGasFee : maxGasFee;
</script>

{#if sent}
  <div class="liquid-stake__done">
    <TransactionResult
      leaveHref="/dashboard/stake"
      leaveText="Back to staking"
      maxFee={sent.maxFee}
      operation={sent.operation}
      what={sent.what}
    />
  </div>
{:else}
  <StakeFlow
    canReview={canSend}
    {isReviewing}
    on:back={() => {
      isReviewing = false;
      forgetTerms();
    }}
    on:review={() => {
      isReviewing = true;
    }}
    title="Liquid staking"
  >
    <div class="liquid-stake__intro">
      <p class="liquid-stake__who">
        Sozu <span class="liquid-stake__tag">third party</span>
      </p>
      <p>
        Sozu, not Dusk, holds the DUSK you stake here and returns it under
        Sozu's own rules: <a
          class="liquid-stake__link text-link"
          href={SOZU_URL}
          rel="noopener noreferrer"
          target="_blank">sozu.fi</a
        >.
      </p>
    </div>

    {#if isSyncing}
      <p class="liquid-stake__notice" role="status">
        Sozu is updating its pool, so a stake or an unstake sent now can fail.
      </p>
    {/if}

    {#if !status && sozu.loading}
      <p class="liquid-stake__hint">Reading Sozu's pool…</p>
    {:else if !status}
      <div class="liquid-stake__error" role="alert">
        <p><strong>Couldn't reach Sozu.</strong> Check your connection.</p>
        <Button
          on:click={onRetry}
          size="small"
          text="Try again"
          variant="secondary"
        />
      </div>
    {/if}

    {#if staked > 0n || stDusk > 0n}
      <dl class="liquid-stake__position">
        <div>
          <dt>Staked with Sozu</dt>
          <dd>
            <BalanceValue
              exact={formatDuskExact(staked, language)}
              value={formatDusk(staked, language)}
            /> DUSK
          </dd>
        </div>
        <div>
          <dt>stDUSK</dt>
          <dd>
            <BalanceValue
              exact={formatDuskExact(stDusk, language)}
              value={formatDusk(stDusk, language)}
            /> stDUSK
          </dd>
        </div>
      </dl>
    {/if}

    <div class="liquid-stake__field">
      <div
        aria-label="Liquid staking"
        class="liquid-stake__tabs"
        role="tablist"
      >
        {#each TABS as tab (tab)}
          <button
            aria-controls="{id}-panel"
            aria-selected={action === tab}
            class="liquid-stake__tab"
            class:liquid-stake__tab--on={action === tab}
            id="{id}-tab-{tab}"
            on:click={() => pick(tab)}
            on:keydown={handleTabKey}
            role="tab"
            tabindex={action === tab ? 0 : -1}
            type="button">{tab === "stake" ? "Stake" : "Unstake"}</button
          >
        {/each}
      </div>

      <div
        aria-labelledby="{id}-tab-{action}"
        class="liquid-stake__panel"
        id="{id}-panel"
        role="tabpanel"
      >
        <label class="liquid-stake__label" for="{id}-amount"
          >{isStake ? "Stake amount" : "Unstake amount"}</label
        >
        <div class="liquid-stake__amount">
          <Textbox
            aria-describedby="{id}-available {id}-check"
            aria-invalid={Boolean(check.error)}
            autocomplete="off"
            bind:value={amountText}
            className="liquid-stake__input"
            disabled={!status || isStakeOff}
            id="{id}-amount"
            inputmode="decimal"
            on:input={forgetTerms}
            type="text"
          />
          <span aria-hidden="true" class="liquid-stake__unit">DUSK</span>
          <Button
            disabled={!status || isStakeOff || most <= 0n}
            on:click={() => fill(most)}
            size="small"
            text="Max"
            title={isStake
              ? "All of it, less the network fee"
              : "All you have staked with Sozu"}
            variant="secondary"
          />
        </div>
        <p class="liquid-stake__hint" id="{id}-available">
          {#if isStake}
            Available <BalanceValue
              exact={formatDuskExact(availableBalance, language)}
              value={formatDusk(availableBalance, language)}
            /> DUSK from your public balance
          {:else}
            Staked with Sozu <BalanceValue
              exact={formatDuskExact(staked, language)}
              value={formatDusk(staked, language)}
            /> DUSK
          {/if}
        </p>
        <div id="{id}-check">
          {#if isPaused}
            <p class="liquid-stake__error" role="alert">
              <strong>Sozu has paused deposits.</strong> Unstaking still works.
            </p>
          {:else if isUnchecked}
            <p class="liquid-stake__error" role="alert">
              <strong>Sozu's deposits couldn't be checked.</strong> Staking stays
              off until they can be. Unstaking still works.
            </p>
          {:else if check.error}
            <p class="liquid-stake__error" role="alert">
              <strong>{check.error}</strong>
            </p>
          {:else if estimate !== null}
            <div class="liquid-stake__estimate">
              <p>
                You get about {formatDusk(estimate, language)} stDUSK, worth about
                {formatDusk(stake.worth, language)} DUSK now.
              </p>
              <p>
                stDUSK is Sozu's token for your share. Its DUSK value follows
                Sozu's pool, its rewards and its fees.
              </p>
            </div>
          {:else if !isStake}
            <div class="liquid-stake__estimate">
              <p>
                The DUSK comes back in the same transaction. No fee, no waiting.
              </p>
            </div>
          {/if}
        </div>
      </div>
    </div>

    <ul class="liquid-stake__facts">
      <li>
        <Icon path={mdiWaterOutline} />
        <div>
          <p class="liquid-stake__fact">Any amount, no node needed</p>
          <p>You get stDUSK, a token for your share of Sozu's pool.</p>
        </div>
      </li>
      {#if fees}
        <li>
          <Icon path={mdiPercentOutline} />
          <div>
            <p class="liquid-stake__fact">Sozu's fees</p>
            <p>
              {feePercent(fees.deposit, language)} of each deposit · {feePercent(
                fees.reward,
                language
              )} of rewards · no unstake fee
            </p>
          </div>
        </li>
      {/if}
      {#if status}
        <li>
          <Icon path={mdiFileDocumentOutline} />
          <div>
            <p class="liquid-stake__fact">Sozu's contract</p>
            <p>
              <code title={status.contracts.pool}
                >{shortenAddress(status.contracts.pool)}</code
              >
            </p>
          </div>
          <Button
            aria-label="Copy Sozu's contract ID"
            on:click={copyContract}
            size="small"
            text="Copy"
            variant="secondary"
          />
        </li>
      {/if}
    </ul>

    <svelte:fragment slot="summary">
      {#if termsChanged}
        <div class="liquid-stake__changed" role="alert">
          <p>Sozu's terms changed</p>
          <p>These are the figures now. Check them, then confirm again.</p>
        </div>
      {/if}
      <dl class="stake-flow__rows">
        <div>
          <dt>{isStake ? "Stake with Sozu" : "Unstake from Sozu"}</dt>
          <dd class:stake-flow__muted={isTypedOff}>
            {formatDuskExact(typedAmount, language)} DUSK
          </dd>
        </div>
        {#if isStake}
          <div>
            <dt>You get about</dt>
            <dd>
              {estimate === null ? "—" : formatDusk(estimate, language)} stDUSK
            </dd>
          </div>
          <div>
            <dt>Deposit fee</dt>
            <dd class:stake-flow__muted={isTypedOff && depositFee !== null}>
              {depositRate && depositFee !== null
                ? `${feePercent(depositRate, language)} · ${formatDuskExact(depositFee, language)} DUSK`
                : "Taken from the deposit"}
            </dd>
          </div>
          <div>
            <dt>Getting it back</dt>
            <dd>Unstake any time. No fee, no waiting.</dd>
          </div>
        {:else}
          <div>
            <dt>Back to</dt>
            <dd>Your public balance, in the same transaction</dd>
          </div>
          <div>
            <dt>Sozu's fee</dt>
            <dd>No unstake fee</dd>
          </div>
        {/if}
        <div>
          <dt>Fee paid from</dt>
          <dd>Public balance</dd>
        </div>
      </dl>
      <GasSettings
        fee={maxGasFee}
        limit={gasLimit}
        limitLower={gasLimits.gasLimitLower}
        limitUpper={gasLimits.gasLimitUpper}
        on:gasSettings={(event) => {
          if (
            event.detail.limit !== gasLimit ||
            event.detail.price !== gasPrice
          ) {
            forgetTerms();
          }

          isGasValid = areValidGasSettings(
            event.detail.price,
            event.detail.limit,
            gasLimits
          );

          if (isGasValid) {
            gasPrice = event.detail.price;
            gasLimit = event.detail.limit;
          }
        }}
        price={gasPrice}
        priceLower={gasLimits.gasPriceLower}
      />
      <p class="liquid-stake__gas-note">
        A call that fails is charged its whole gas limit.
      </p>
      <dl class="stake-flow__rows stake-flow__rows--total">
        <div>
          <dt>Total</dt>
          <dd class:stake-flow__muted={isTypedOff}>
            Up to {formatTotal(total, availableBalance, language)} DUSK
          </dd>
        </div>
      </dl>
      {#if termsError}
        <p class="liquid-stake__error" role="alert">
          <strong>{termsError}, so nothing was sent.</strong> Try again.
        </p>
      {/if}
      <Button
        className="stake-flow__send"
        disabled={!canSend || isChecking}
        on:click={send}
        text={canSend
          ? isStake
            ? `Stake ${formatDuskExact(shownAmount, language)} DUSK with Sozu`
            : `Unstake ${formatDuskExact(shownAmount, language)} DUSK`
          : isStake
            ? "Stake with Sozu"
            : "Unstake"}
        variant="primary"
      />
    </svelte:fragment>
  </StakeFlow>
{/if}

<style lang="postcss">
  .liquid-stake__done {
    width: min(100%, 40rem);
    margin: 0 auto;
    padding: 2rem 1.5rem;
  }

  .liquid-stake__intro {
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
    font-size: 0.9375rem;
  }

  .liquid-stake__who {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-weight: 500;
  }

  .liquid-stake__tag {
    padding: 0.125rem 0.5rem;
    border-radius: 999px;
    background: var(--calm-s2);
    font-size: 0.78125rem;
    font-weight: 400;
  }

  .liquid-stake__link {
    text-decoration: underline;
    text-underline-offset: 2px;
  }

  .liquid-stake__position {
    display: flex;
    flex-wrap: wrap;
    gap: 2rem;
    margin: 0;
    padding: 1rem 1.125rem;
    border-radius: 0.875rem;
    background: var(--calm-s1);

    & dt {
      color: var(--calm-muted);
      font-size: 0.84375rem;
    }

    & dd {
      margin: 0.25rem 0 0;
      font-size: 1.125rem;
      font-variant-numeric: tabular-nums;
    }
  }

  .liquid-stake__field,
  .liquid-stake__panel {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .liquid-stake__tabs {
    display: inline-flex;
    align-self: flex-start;
    gap: 0.25rem;
    margin-bottom: 0.5rem;
    padding: 0.25rem;
    border-radius: 999px;
    background: var(--calm-s1);
  }

  .liquid-stake__tab {
    all: unset;
    min-width: 5rem;
    min-height: 2.25rem;
    padding: 0 1rem;
    border-radius: 999px;
    color: var(--calm-muted);
    font-size: 0.875rem;
    text-align: center;
    cursor: pointer;

    &:focus-visible {
      outline: 2px solid var(--calm-focus);
    }
  }

  .liquid-stake__tab--on {
    background: var(--calm-s2);
    color: var(--calm-text);
  }

  .liquid-stake__label {
    color: var(--calm-muted);
    font-size: 0.875rem;
  }

  .liquid-stake__amount {
    display: flex;
    align-items: center;
    gap: 0.5rem;

    & :global(.liquid-stake__input) {
      flex: 1;
      min-width: 0;
      height: 3.25rem;
      font-size: 1.25rem;
      font-variant-numeric: tabular-nums;
    }
  }

  .liquid-stake__unit {
    color: var(--calm-muted);
  }

  .liquid-stake__hint,
  .liquid-stake__gas-note {
    color: var(--calm-muted);
    font-size: 0.84375rem;
  }

  .liquid-stake__notice {
    padding: 0.75rem 0.875rem;
    border-radius: 0.75rem;
    background: var(--calm-s1);
    font-size: 0.875rem;
  }

  .liquid-stake__error {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.375rem;
    font-size: 0.875rem;

    & strong {
      color: var(--calm-danger);
      font-weight: 500;
    }
  }

  .liquid-stake__estimate,
  .liquid-stake__changed {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    padding: 0.75rem 0.875rem;
    border-radius: 0.75rem;
    background: var(--calm-s1);
    font-size: 0.875rem;

    & p:first-child {
      font-weight: 500;
    }
  }

  .liquid-stake__facts {
    display: flex;
    flex-direction: column;
    margin: 0;
    padding: 0;
    list-style: none;

    & li {
      display: flex;
      align-items: flex-start;
      gap: 0.875rem;
      padding: 0.875rem 0;
      border-top: 1px solid var(--calm-line);
      font-size: 0.875rem;
    }

    & li > div {
      flex: 1;
      min-width: 0;
    }

    & li > :global(.dusk-icon) {
      flex: 0 0 auto;
      width: 1.25rem;
      height: 1.25rem;
      margin-top: 0.0625rem;
      color: var(--calm-muted);
    }

    & code {
      color: var(--calm-muted);
      font-family: var(--code-font-family);
      font-size: 0.8125rem;
    }
  }

  .liquid-stake__fact {
    margin-bottom: 0.25rem;
    font-weight: 500;
  }
</style>
