<svelte:options immutable={true} />

<script>
  import { onMount, tick } from "svelte";
  import {
    mdiAlertCircleOutline,
    mdiContentCopy,
    mdiFileDocumentOutline,
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
  import { leastSozuStake, stDuskFor } from "$lib/sozu/amounts";
  import { settingsStore } from "$lib/stores";

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

  /** @type {GasStoreContent} */
  export let gasLimits;

  /** @type {ContractGasSettings} */
  export let gasSettings;

  /** @type {() => void} */
  export let onRetry = () => {};

  const id = randomUUID();

  /** @type {("stake" | "unstake")[]} */
  const TABS = ["stake", "unstake"];

  /** The amount typed, and the one typed for the other action. */
  let amountText = "";
  let otherText = "";
  let isReviewing = false;
  let { gasLimit, gasPrice } = gasSettings;
  let defaultGas = gasSettings;
  let isGasValid = false;

  /** @type {{ maxFee: bigint, operation: Promise<string>, what: string } | null} */
  let sent = null;

  /** @param {"stake" | "unstake"} next */
  async function pick(next) {
    if (next !== action) {
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

  function send() {
    if (status && amount !== null && canSend) {
      sent = {
        maxFee: maxGasFee,
        operation: execute(
          action,
          status.contracts.pool,
          amount,
          gasPrice,
          gasLimit
        ),
        what: isStake
          ? `${formatDuskExact(amount, language)} DUSK to Sozu`
          : `${formatDuskExact(amount, language)} DUSK unstaked from Sozu`,
      };
    }
  }

  onMount(() => {
    isGasValid = areValidGasSettings(gasPrice, gasLimit, gasLimits);
  });

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
  $: isStake = action === "stake";
  $: maxGasFee = gasLimit * gasPrice;
  $: staked = status?.position.balance ?? 0n;
  $: stDusk = status?.position.stDusk ?? 0n;
  $: most = isStake
    ? availableBalance > maxGasFee
      ? availableBalance - maxGasFee
      : 0n
    : staked;
  $: amount = parseDuskInput(amountText);
  $: check = checkAmount({
    amount,
    available: availableBalance,
    fee: maxGasFee,
    locale: language,
    // Less than this gets no stDUSK at the rate now.
    minimum: isStake ? leastSozuStake(status?.pool ?? null) : 0n,
    most: isStake
      ? undefined
      : {
          amount: staked,
          error: "That's more than you have staked with Sozu.",
        },
    text: amountText,
  });
  $: canSend = Boolean(status) && check.ok && isGasValid;
  $: shownAmount = amount !== null && check.ok ? amount : 0n;
  $: estimate =
    isStake && check.ok ? stDuskFor(shownAmount, status?.pool ?? null) : null;
  // What is typed shows in the summary, muted while it can't be sent.
  $: typedAmount = amount ?? 0n;
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
          class="liquid-stake__link"
          href={SOZU_URL}
          rel="noopener noreferrer"
          target="_blank">sozu.fi</a
        >.
      </p>
    </div>

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
            disabled={!status}
            id="{id}-amount"
            inputmode="decimal"
            type="text"
          />
          <span aria-hidden="true" class="liquid-stake__unit">DUSK</span>
          <Button
            disabled={!status || most <= 0n}
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
          {#if check.error}
            <p class="liquid-stake__error" role="alert">
              <strong>{check.error}</strong>
            </p>
          {:else if estimate !== null}
            <div class="liquid-stake__estimate">
              <p>
                You get about {formatDusk(estimate, language)} stDUSK, at the rate
                Sozu's contract gives now.
              </p>
              <p>
                stDUSK is Sozu's token for your share. Its DUSK value follows
                Sozu's pool, its rewards and its fees.
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
            <dt>Sozu's fee</dt>
            <dd>Taken from the deposit</dd>
          </div>
          <div>
            <dt>Getting it back</dt>
            <dd>Unstake from Sozu, under Sozu's rules</dd>
          </div>
        {:else}
          <div>
            <dt>Back to</dt>
            <dd>Your public balance</dd>
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
      <dl class="stake-flow__rows stake-flow__rows--total">
        <div>
          <dt>Total</dt>
          <dd class:stake-flow__muted={isTypedOff}>
            Up to {formatTotal(total, availableBalance, language)} DUSK
          </dd>
        </div>
      </dl>
      <Button
        className="stake-flow__send"
        disabled={!canSend}
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
    color: var(--calm-text);
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

  .liquid-stake__hint {
    color: var(--calm-muted);
    font-size: 0.84375rem;
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

  .liquid-stake__estimate {
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
