<svelte:options immutable={true} />

<script>
  import { onMount } from "svelte";
  import { page } from "$app/stores";
  import {
    mdiAlertCircleOutline,
    mdiClockOutline,
    mdiLockOutline,
    mdiOpenInNew,
    mdiServerOutline,
  } from "@mdi/js";

  import {
    BALANCE_MASK,
    DOCUMENTATION_LINKS,
    withoutBalanceMask,
  } from "$lib/constants";
  import { areValidGasSettings, followDefaultGas } from "$lib/contracts";
  import {
    formatDusk,
    formatDuskExact,
    formatDuskPlain,
    formatFee,
    formatTotal,
  } from "$lib/dusk/currency";
  import { getDecimalSeparator } from "$lib/dusk/number";
  import { randomUUID } from "$lib/dusk/string";
  import { Button, Icon, Textbox } from "$lib/dusk/components";
  import { settingsStore } from "$lib/stores";
  import {
    addBasePath,
    formDraft,
    gasToKeep,
    keptGas,
    reviewStep,
  } from "$lib/navigation";

  import BalanceValue from "../BalanceValue/BalanceValue.svelte";
  import GasSettings from "../GasSettings/GasSettings.svelte";
  import TransactionResult from "../TransactionResult/TransactionResult.svelte";
  import StakeFlow from "./StakeFlow.svelte";
  import { checkAmount, readDuskInput } from "./stakeAmount";

  /**
   * Native staking: the amount, checked as it is typed against the minimum
   * and the public balance, what staking natively takes, and a summary with
   * Review; then the review, with the button that stakes. With a stake
   * already, it adds to it.
   */

  /** @type {(amount: bigint, gasPrice: bigint, gasLimit: bigint) => Promise<string>} */
  export let execute;

  /** The public balance, which pays the stake and its fee. */
  /** @type {bigint} */
  export let availableBalance;

  /** @type {bigint} */
  export let minimumStake;

  /** Whether there is a stake, which the amount adds to. */
  export let hasStake = false;

  /** @type {GasStoreContent} */
  export let gasLimits;

  /** @type {ContractGasSettings} */
  export let gasSettings;

  /** The most it costs to unstake later, which the public balance keeps. */
  /** @type {bigint} */
  export let unstakeFee;

  /** Where liquid staking is, when this network has it. */
  /** @type {string | undefined} */
  export let liquidHref = undefined;

  const id = randomUUID();

  const draft = formDraft("stake-native");

  /** What was typed before a lock, a reload or a failed stake. */
  const typedBefore = draft.read();

  let amountText = typedBefore?.amount ?? "";

  /** Whether Max filled the amount in: it's hidden with the balances. */
  let isMaxAmount = typedBefore?.isMax ?? false;
  let isReviewing = false;
  let { gasLimit, gasPrice } = keptGas(typedBefore?.gas, gasSettings);
  let defaultGas = gasSettings;
  let isGasValid = false;

  /** @type {{ maxFee: bigint, operation: Promise<string>, what: string } | null} */
  let sent = null;

  /** Whether the stake failed with nothing sent: it can be tried again. */
  let canTryAgain = false;

  const reviewHistory = reviewStep("stakeReview");

  /**
   * @param {bigint} lux
   * @param {boolean} [isMax]
   */
  function fill(lux, isMax = false) {
    amountText = formatDuskPlain(lux).replace(
      ".",
      getDecimalSeparator(language)
    );
    isMaxAmount = isMax;
    document.getElementById(`${id}-amount`)?.focus();
  }

  /** @param {Event} event */
  function typeAmount(event) {
    amountText = withoutBalanceMask(
      /** @type {HTMLInputElement} */ (event.currentTarget).value
    );
    isMaxAmount = false;
  }

  function stake() {
    if (amount !== null && check.ok && isGasValid) {
      // It goes out now, as far as a reload can tell: nothing brings it back.
      draft.clear();

      const operation = execute(amount, gasPrice, gasLimit);

      sent = {
        maxFee: maxGasFee,
        operation,
        what: `${hideBalances ? BALANCE_MASK : formatDuskExact(amount, language)} DUSK to your stake`,
      };
      reviewHistory.settle(operation, () => {
        canTryAgain = true;
        draft.keep(typed);
      });
    }
  }

  /** Back to the review of a stake that failed with nothing sent. */
  function tryAgain() {
    sent = null;
    canTryAgain = false;
    isReviewing = true;
    reviewHistory.enter();
  }

  /**
   * The step where the browser's Back or Forward takes the history: a review
   * only of what can still be staked, and from a stake that failed with
   * nothing sent, the form, with what's filled in.
   *
   * @param {boolean} isAtReview
   */
  function followHistory(isAtReview) {
    if (!sent) {
      isReviewing = isAtReview && canStake;
    } else if (canTryAgain && !isAtReview) {
      sent = null;
      canTryAgain = false;
      isReviewing = false;
    }
  }

  onMount(() => {
    isGasValid = areValidGasSettings(gasPrice, gasLimit, gasLimits);
  });

  $: followHistory(Boolean($page.state?.stakeReview));

  // What's typed, kept as it's typed, for as long as it hasn't gone out.
  $: typed = {
    amount: amountText,
    gas: gasToKeep({ gasLimit, gasPrice }, defaultGas),
    isMax: isMaxAmount,
  };
  $: if (!sent) {
    draft.save(typed);
  }

  // The default gas can change while the page shows, as when the node's
  // price arrives: the page takes it unless its gas was edited here, and
  // keeps the gas a review shows.
  $: if (!sent && !isReviewing && gasSettings !== defaultGas) {
    ({ gasLimit, gasPrice } = followDefaultGas(
      { gasLimit, gasPrice },
      defaultGas,
      gasSettings
    ));
    defaultGas = gasSettings;
    isGasValid = areValidGasSettings(gasPrice, gasLimit, gasLimits);
  }

  $: ({ hideBalances, language } = $settingsStore);
  $: isAmountMasked = hideBalances && isMaxAmount;
  $: maxGasFee = gasLimit * gasPrice;
  // Max keeps this fee, and the one to unstake later: all of it staked, there
  // would be no way to pay for getting it back.
  $: maxStake =
    availableBalance > maxGasFee + unstakeFee
      ? availableBalance - maxGasFee - unstakeFee
      : 0n;
  $: minimum = hasStake ? 0n : minimumStake;
  // A decimal comma, as the language or a phone's keyboard gives it, reads
  // as the amount meant.
  $: amount = readDuskInput(amountText, language);
  $: check = checkAmount({
    amount,
    available: availableBalance,
    fee: maxGasFee,
    hidden: hideBalances,
    keep: unstakeFee,
    locale: language,
    minimum,
    text: amountText,
  });

  // Below the minimum before anything is typed: said at once.
  $: isBelowMinimum = minimum > 0n && maxStake < minimum;
  $: canStake = check.ok && isGasValid;
  $: shownAmount = amount !== null && check.ok ? amount : 0n;

  // What is typed shows in the summary, muted while it can't be staked.
  $: typedAmount = amount ?? 0n;
  $: isTypedOff = Boolean(check.error);
  $: minimumText = formatDusk(minimumStake, language);
  $: liquidText = `Less than ${minimumText} DUSK? Use liquid staking (Sozu, third party)`;
</script>

{#if sent}
  <div class="native-stake__done">
    <TransactionResult
      leaveHref="/dashboard/stake"
      leaveText="Back to staking"
      maxFee={sent.maxFee}
      onRetry={tryAgain}
      operation={sent.operation}
      what={sent.what}
    />
  </div>
{:else}
  <StakeFlow
    canReview={canStake}
    isFeeShort={availableBalance >=
      gasLimits.gasLimitLower * gasLimits.gasPriceLower &&
      availableBalance < maxGasFee}
    {isReviewing}
    on:back={() => {
      reviewHistory.leave();
      isReviewing = false;
    }}
    on:review={() => {
      reviewHistory.enter();
      isReviewing = true;
    }}
    title={hasStake ? "Stake more" : "Native staking"}
  >
    <div class="native-stake__field">
      <label class="native-stake__label" for="{id}-amount"
        >{hasStake ? "Amount to add" : "Stake amount"}</label
      >
      <div class="native-stake__amount">
        <Textbox
          aria-describedby={isAmountMasked
            ? `${id}-amount-hidden`
            : `${id}-available ${id}-error`}
          aria-invalid={Boolean(check.error)}
          autocomplete="off"
          className="native-stake__input"
          id="{id}-amount"
          inputmode="decimal"
          on:input={typeAmount}
          placeholder="0"
          type="text"
          value={isAmountMasked ? BALANCE_MASK : amountText}
        />
        {#if isAmountMasked}
          <span hidden id="{id}-amount-hidden">hidden</span>
        {/if}
        <span aria-hidden="true" class="native-stake__unit">DUSK</span>
        <Button
          disabled={maxStake <= 0n}
          on:click={() => fill(maxStake, true)}
          size="small"
          text="Max"
          title="All of it, less the network fee and the fee to unstake later"
          variant="secondary"
        />
      </div>
      {#if !hasStake && maxStake >= minimumStake}
        <div class="native-stake__fills">
          <Button
            on:click={() => fill(minimumStake)}
            size="small"
            text="Use {minimumText}"
            variant="secondary"
          />
        </div>
      {/if}
      <p class="native-stake__hint" id="{id}-available">
        {hasStake ? "" : `Minimum ${minimumText} DUSK · `}Available <BalanceValue
          exact={formatDuskExact(availableBalance, language)}
          value={formatDusk(availableBalance, language)}
        /> DUSK from your public balance
      </p>
      {#if isMaxAmount && !check.error}
        <p class="native-stake__hint">
          Max keeps {formatFee(maxGasFee + unstakeFee, language, { max: true })} DUSK:
          up to {formatFee(maxGasFee, language, { max: true })} for this fee and {formatFee(
            unstakeFee,
            language,
            { max: true }
          )} to unstake later.
        </p>
      {/if}
      <div id="{id}-error">
        {#if check.error}
          <div class="native-stake__error" role="alert">
            <Icon path={mdiAlertCircleOutline} />
            <div>
              <p><strong>{check.error}</strong></p>
              {#if check.isMinimum && liquidHref}
                <a
                  class="native-stake__link text-link"
                  href={addBasePath(liquidHref)}>{liquidText}</a
                >
              {/if}
            </div>
          </div>
        {:else if isBelowMinimum && !amountText}
          <div class="native-stake__note">
            <p>
              Your public balance doesn't cover the {minimumText} DUSK minimum, this
              fee and the fee to unstake later.
            </p>
            {#if liquidHref}
              <a
                class="native-stake__link text-link"
                href={addBasePath(liquidHref)}>{liquidText}</a
              >
            {/if}
          </div>
        {/if}
      </div>
    </div>

    <ul class="native-stake__facts">
      <li>
        <Icon path={mdiServerOutline} />
        <div>
          <p class="native-stake__fact">Needs your own Dusk node</p>
          <p>
            <a
              class="native-stake__link text-link"
              href={DOCUMENTATION_LINKS.RUN_A_PROVISIONER}
              rel="noopener noreferrer"
              target="_blank">Run a node <Icon path={mdiOpenInNew} /></a
            >
          </p>
        </div>
      </li>
      <li>
        <Icon path={mdiClockOutline} />
        <div>
          <p class="native-stake__fact">Rewards start in about 6 to 12 hours</p>
          <p>Unstake any time, with no waiting period.</p>
        </div>
      </li>
      {#if hasStake}
        <li>
          <Icon path={mdiLockOutline} />
          <div>
            <p class="native-stake__fact">10% of what you add is locked</p>
            <p>
              When your stake is already active. It's still yours, and unstaking
              returns it.
            </p>
          </div>
        </li>
      {/if}
      <li>
        <Icon path={mdiAlertCircleOutline} />
        <div>
          <p class="native-stake__fact">If your node misses its turn</p>
          <p>
            Part of your stake gets locked. It's still yours, and unstaking
            returns it. If the node breaks the rules, part of the stake can be
            burned (lost).
          </p>
        </div>
      </li>
    </ul>

    <svelte:fragment slot="summary">
      <dl class="stake-flow__rows">
        <div>
          <dt>{hasStake ? "Add to stake" : "Stake"}</dt>
          <dd class:stake-flow__muted={isTypedOff}>
            <BalanceValue
              hidden={isAmountMasked}
              value={formatDuskExact(typedAmount, language)}
            /> DUSK
          </dd>
        </div>
        {#if !hasStake}
          <div>
            <dt>Rewards start</dt>
            <dd>In about 6 to 12 hours</dd>
          </div>
        {/if}
        <div>
          <dt>Paid from</dt>
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
            Up to <BalanceValue
              hidden={isAmountMasked}
              value={formatTotal(
                typedAmount + maxGasFee,
                availableBalance,
                language
              )}
            /> DUSK
          </dd>
        </div>
      </dl>
      <!-- A step of its own: nothing goes before it, and Stake, new with it,
        takes no click meant for Review. -->
      {#if isReviewing}
        <Button
          className="stake-flow__send"
          confirm
          disabled={!canStake}
          on:click={stake}
          text={canStake
            ? `Stake ${isAmountMasked ? BALANCE_MASK : formatDuskExact(shownAmount, language)} DUSK`
            : "Stake"}
          variant="primary"
        />
      {/if}
    </svelte:fragment>
  </StakeFlow>
{/if}

<style lang="postcss">
  .native-stake__done {
    width: min(100%, 40rem);
    margin: 0 auto;
    padding: 2rem 1.5rem;
  }

  .native-stake__field {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .native-stake__label {
    color: var(--calm-muted);
    font-size: 0.875rem;
  }

  .native-stake__amount {
    display: flex;
    align-items: center;
    gap: 0.5rem;

    & :global(.native-stake__input) {
      flex: 1;
      min-width: 0;
      height: 3.25rem;
      font-size: 1.25rem;
      font-variant-numeric: tabular-nums;
    }
  }

  .native-stake__unit {
    color: var(--calm-muted);
  }

  .native-stake__fills {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }

  .native-stake__hint {
    color: var(--calm-muted);
    font-size: 0.84375rem;
  }

  .native-stake__error,
  .native-stake__note {
    display: flex;
    gap: 0.625rem;
    padding: 0.75rem 0.875rem;
    border-radius: 0.75rem;
    font-size: 0.875rem;
  }

  .native-stake__error {
    border: 1px solid var(--calm-danger);

    & > div {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 0.375rem;
    }

    & > :global(.dusk-icon) {
      flex: 0 0 auto;
      width: 1.125rem;
      height: 1.125rem;
      color: var(--calm-danger);
    }

    & strong {
      color: var(--calm-danger);
      font-weight: 500;
    }
  }

  .native-stake__note {
    flex-direction: column;
    gap: 0.375rem;
    background: var(--calm-s1);
  }

  .native-stake__link {
    text-decoration: underline;
    text-underline-offset: 2px;

    & :global(.dusk-icon) {
      display: inline;
      width: 0.875rem;
      height: 0.875rem;
      vertical-align: -0.125rem;
    }
  }

  .native-stake__facts {
    display: flex;
    flex-direction: column;
    margin: 0;
    padding: 0;
    list-style: none;

    & li {
      display: flex;
      gap: 0.875rem;
      padding: 0.875rem 0;
      border-top: 1px solid var(--calm-line);
      font-size: 0.875rem;
    }

    & li > :global(.dusk-icon) {
      flex: 0 0 auto;
      width: 1.25rem;
      height: 1.25rem;
      margin-top: 0.0625rem;
      color: var(--calm-muted);
    }
  }

  .native-stake__fact {
    margin-bottom: 0.25rem;
    font-weight: 500;
  }
</style>
