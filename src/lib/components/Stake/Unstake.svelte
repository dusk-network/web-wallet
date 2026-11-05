<svelte:options immutable={true} />

<script>
  import { createEventDispatcher, onMount } from "svelte";

  import { BALANCE_MASK, withoutBalanceMask } from "$lib/constants";
  import { areValidGasSettings, followDefaultGas } from "$lib/contracts";
  import {
    formatDusk,
    formatDuskExact,
    formatDuskPlain,
    formatFee,
  } from "$lib/dusk/currency";
  import { getDecimalSeparator } from "$lib/dusk/number";
  import { randomUUID } from "$lib/dusk/string";
  import { formDraft, gasToKeep, keptGas } from "$lib/navigation";
  import { settingsStore } from "$lib/stores";
  import { nothingWentOut } from "$lib/transactions";

  import {
    Button,
    Stepper,
    Textbox,
    Wizard,
    WizardStep,
  } from "$lib/dusk/components";
  import {
    BalanceValue,
    GasSettings,
    ReviewAmount,
    ReviewWallet,
    TransactionResult,
  } from "$lib/components";

  import { checkAmount, readDuskInput } from "./stakeAmount";

  /** @type {(...args: any[]) => Promise<string>} */
  export let execute;

  /** @type {GasStoreContent} */
  export let gasLimits;

  /** @type {ContractGasSettings} */
  export let gasSettings;

  /** @type {bigint} */
  export let maxWithdrawAmount;

  /** @type {string} */
  export let operationCtaLabel;

  /** @type {string} */
  export let operationCtaIconPath;

  /** @type {string} */
  export let operationOverviewLabel;

  /** @type {bigint} */
  export let availableBalance;

  /**
   * @type {bigint|undefined}
   * If `minStakeRequirement` is undefined, it indicates that the user is claiming rewards.
   * If it is defined, it means the user is performing an unstaking operation.
   */
  export let minStakeRequirement;

  const draft = formDraft(
    minStakeRequirement === undefined ? "stake-claim" : "stake-unstake"
  );

  /** What was typed before a lock, a reload or a failed send. */
  const typedBefore = draft.read();

  let activeStep = 0;
  let { gasLimit, gasPrice } = keptGas(typedBefore?.gas, gasSettings);
  let defaultGas = gasSettings;
  let isGasValid = false;

  const id = randomUUID();

  /**
   * An amount in DUSK as the field shows it, with the language's decimal
   * separator.
   *
   * @param {bigint} lux
   */
  const asTyped = (lux) =>
    formatDuskPlain(lux).replace(".", getDecimalSeparator(language));

  // The amount as typed, as in the other amount fields: it starts at all
  // that can be withdrawn.
  let amountText = typedBefore?.amount || asTyped(maxWithdrawAmount);

  /**
   * Whether the user typed an amount or used the maximum. The amount
   * starts at all they can withdraw, so while balances are hidden, it
   * stays hidden until they do.
   */
  let isAmountChosen = Boolean(typedBefore?.amount);

  // What screen readers read with the amount while it's hidden.
  const hiddenNoteId = `${id}-hidden-note`;

  /**
   * What the review shows and its button sends: the amount and the gas as
   * Next opened the review. A stake read again later changes neither, while
   * the review shows nor once the transaction settled. Null while the
   * amount can be edited.
   *
   * @type {{ amount: bigint, gasLimit: bigint, gasPrice: bigint } | null}
   */
  let reviewed = null;

  /**
   * The transaction, sent once, as the review's button is pressed.
   *
   * @type {Promise<string> | null}
   */
  let sent = null;

  /** @type {WizardStep} */
  let resultStep;

  const steps = [{ label: "Amount" }, { label: "Review" }, { label: "Done" }];

  const dispatch = createEventDispatcher();
  const resetOperation = () => dispatch("operationChange", "");

  /**
   * @param {{detail: {price: bigint, limit: bigint}}} event
   */
  const setGasValues = (event) => {
    isGasValid = areValidGasSettings(
      event.detail.price,
      event.detail.limit,
      gasLimits
    );

    if (isGasValid) {
      gasPrice = event.detail.price;
      gasLimit = event.detail.limit;
    }
  };

  function setMaxAmount() {
    amountText = asTyped(maxWithdrawAmount);
    // Hidden with the balances, as it starts: nothing was typed.
    isAmountChosen = false;
    document.getElementById(`${id}-amount`)?.focus();
  }

  /** @param {Event} event */
  function setWithdrawAmount(event) {
    amountText = withoutBalanceMask(
      /** @type {HTMLInputElement} */ (event.currentTarget).value
    );
    isAmountChosen = true;
  }

  function review() {
    reviewed = { amount: withdrawAmountInLux, gasLimit, gasPrice };
    activeStep++;
  }

  function send() {
    if (reviewed && !sent) {
      // It goes out now, as far as a reload can tell: nothing brings it back.
      draft.clear();
      sent = execute(reviewed.amount, reviewed.gasPrice, reviewed.gasLimit);
      sent.catch((error) => {
        if (nothingWentOut(error)) {
          draft.keep(typed);
        }
      });
    }

    activeStep++;
  }

  /**
   * Back to the review of what failed with nothing sent.
   *
   * @param {MouseEvent} event
   */
  function tryAgain(event) {
    sent = null;
    activeStep--;
    resultStep.back(event);
  }

  onMount(() => {
    isGasValid = areValidGasSettings(gasPrice, gasLimit, gasLimits);
  });

  // What's typed, kept as it's typed, for as long as it hasn't gone out: the
  // amount it starts with isn't.
  $: typed = {
    amount: isAmountChosen ? amountText : "",
    gas: gasToKeep({ gasLimit, gasPrice }, defaultGas),
  };
  $: if (!sent) {
    draft.save(typed);
  }

  $: ({ hideBalances, language } = $settingsStore);
  $: isAmountHidden = hideBalances && !isAmountChosen;
  $: isUnstake = minStakeRequirement !== undefined;

  // Calculate the maximum gas fee based on the gas limit and gas price.
  $: maxGasFee = gasLimit * gasPrice;

  // The default gas can change while the form is open, as when the node's
  // price arrives: the form takes it while its gas can be edited, unless it
  // was edited here, and keeps the gas a review shows.
  $: if (activeStep === 0 && gasSettings !== defaultGas) {
    ({ gasLimit, gasPrice } = followDefaultGas(
      { gasLimit, gasPrice },
      defaultGas,
      gasSettings
    ));
    defaultGas = gasSettings;
    isGasValid = areValidGasSettings(gasPrice, gasLimit, gasLimits);
  }

  // A decimal comma, as the language or a phone's keyboard gives it, reads
  // as the amount meant, as in the other amount fields.
  $: amount = readDuskInput(amountText, language);

  // At most all that can be withdrawn, with the fee paid from the public
  // balance, and said as the other amount fields say it.
  $: checked = checkAmount({
    action: "unstake",
    amount,
    available: availableBalance,
    fee: maxGasFee,
    hidden: hideBalances,
    locale: language,
    most: {
      amount: maxWithdrawAmount,
      error: isUnstake
        ? "That's more than you have staked."
        : "That's more than your rewards.",
    },
    text: amountText,
  });

  // An unstake leaves at least the minimum staked, or nothing.
  $: leavesTooLittle =
    isUnstake &&
    checked.ok &&
    amount !== maxWithdrawAmount &&
    maxWithdrawAmount - /** @type {bigint} */ (amount) <
      /** @type {bigint} */ (minStakeRequirement);

  $: check = leavesTooLittle
    ? {
        error: `Leave at least ${formatDusk(/** @type {bigint} */ (minStakeRequirement), language)} DUSK staked, or unstake it all.`,
        ok: false,
      }
    : checked;
  $: withdrawAmountInLux = amount !== null && check.ok ? amount : 0n;
  $: isNextButtonDisabled = !(check.ok && isGasValid);
</script>

<div class="operation">
  <Wizard steps={3} let:key>
    <div slot="stepper">
      <Stepper {activeStep} {steps} />
    </div>

    <WizardStep
      step={0}
      {key}
      backButton={{
        action: resetOperation,
        disabled: false,
      }}
      nextButton={{
        action: review,
        disabled: isNextButtonDisabled,
      }}
    >
      <div class="operation__field">
        <label class="operation__label" for="{id}-amount">Amount</label>
        <div class="operation__amount">
          <Textbox
            aria-describedby={isAmountHidden
              ? hiddenNoteId
              : `${id}-available ${id}-check`}
            aria-invalid={Boolean(check.error)}
            autocomplete="off"
            className="operation__input"
            id="{id}-amount"
            inputmode="decimal"
            on:input={setWithdrawAmount}
            type="text"
            value={isAmountHidden ? BALANCE_MASK : amountText}
          />
          <span aria-hidden="true" class="operation__unit">DUSK</span>
          <Button
            disabled={maxWithdrawAmount <= 0n}
            on:click={setMaxAmount}
            size="small"
            text="Max"
            title={isUnstake ? "All you have staked" : "All your rewards"}
            variant="secondary"
          />
          {#if isAmountHidden}
            <span hidden id={hiddenNoteId}>hidden</span>
          {/if}
        </div>
        <p class="operation__hint" id="{id}-available">
          {isUnstake ? "Staked" : "Rewards"}
          <BalanceValue
            exact={formatDuskExact(maxWithdrawAmount, language)}
            value={formatDusk(maxWithdrawAmount, language)}
          /> DUSK
        </p>
        <div id="{id}-check">
          {#if check.error}
            <p class="operation__error" role="alert">
              <strong>{check.error}</strong>
            </p>
          {/if}
        </div>
      </div>

      <GasSettings
        fee={maxGasFee}
        limit={gasLimit}
        limitLower={gasLimits.gasLimitLower}
        limitUpper={gasLimits.gasLimitUpper}
        price={gasPrice}
        priceLower={gasLimits.gasPriceLower}
        on:gasSettings={setGasValues}
      />
    </WizardStep>

    <!-- OPERATION OVERVIEW STEP  -->
    <WizardStep
      step={1}
      {key}
      backButton={{
        action: () => {
          reviewed = null;
          activeStep--;
        },
        disabled: false,
      }}
      nextButton={{
        action: send,
        confirm: true,
        icon: {
          path: operationCtaIconPath,
          position: "before",
        },
        label: operationCtaLabel,
        variant: "primary",
      }}
    >
      {#if reviewed}
        <div class="operation__unstake">
          <ReviewWallet />
          <ReviewAmount
            label={operationOverviewLabel}
            value={isAmountHidden
              ? BALANCE_MASK
              : formatDuskExact(reviewed.amount, language)}
          />
          <ReviewAmount
            label="Network fee (at most)"
            value={formatFee(reviewed.gasLimit * reviewed.gasPrice, language, {
              max: true,
            })}
          />
        </div>
      {/if}
    </WizardStep>

    <!-- OPERATION RESULT STEP  -->
    <WizardStep bind:this={resultStep} step={2} {key} showNavigation={false}>
      {#if reviewed && sent}
        <TransactionResult
          leaveHref="/dashboard/stake"
          leaveText="Back to staking"
          maxFee={reviewed.gasLimit * reviewed.gasPrice}
          onBeforeLeave={resetOperation}
          onRetry={tryAgain}
          operation={sent}
        />
      {/if}
    </WizardStep>
  </Wizard>
</div>

<style lang="postcss">
  .operation {
    &__unstake {
      display: flex;
      flex-direction: column;
      gap: 1.2em;
    }

    /* As the other amount fields: Send's, and staking's. */
    &__field {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }

    &__label {
      color: var(--calm-muted);
      font-size: 0.875rem;
    }

    &__amount {
      display: flex;
      align-items: center;
      gap: 0.5rem;

      & :global(.operation__input) {
        flex: 1;
        min-width: 0;
        height: 3.25rem;
        font-size: 1.25rem;
        font-variant-numeric: tabular-nums;
      }
    }

    &__unit {
      color: var(--calm-muted);
    }

    &__hint {
      color: var(--calm-muted);
      font-size: 0.84375rem;
    }

    &__error {
      font-size: 0.875rem;

      & strong {
        color: var(--calm-danger);
        font-weight: 500;
      }
    }
  }
</style>
