<svelte:options immutable={true} />

<script>
  import { createEventDispatcher, onMount } from "svelte";
  import { fade } from "svelte/transition";

  import { BALANCE_MASK } from "$lib/constants";
  import { areValidGasSettings, followDefaultGas } from "$lib/contracts";
  import {
    duskToLux,
    formatDusk,
    formatDuskExact,
    formatFee,
    luxToDusk,
  } from "$lib/dusk/currency";
  import { randomUUID } from "$lib/dusk/string";
  import { settingsStore } from "$lib/stores";

  import {
    Button,
    Stepper,
    Textbox,
    Wizard,
    WizardStep,
  } from "$lib/dusk/components";
  import {
    Banner,
    DuskIcon,
    GasSettings,
    ReviewAmount,
    ReviewWallet,
    TransactionResult,
  } from "$lib/components";

  import { toast } from "$lib/dusk/components/Toast/store";
  import { mdiAlertOutline } from "@mdi/js";

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

  let activeStep = 0;
  let { gasLimit, gasPrice } = gasSettings;
  let defaultGas = gasSettings;
  let isGasValid = false;

  /**
   * We are forced to keep `amount`
   * as number if we want to use
   * Svelte's binding.
   */
  let withdrawAmount = luxToDusk(maxWithdrawAmount);

  /**
   * Whether the user typed an amount or used the maximum. The amount
   * starts at all they can withdraw, so while balances are hidden, it
   * stays hidden until they do.
   */
  let isAmountChosen = false;

  // What screen readers read with the amount while it's hidden.
  const hiddenNoteId = `${randomUUID()}-hidden-note`;

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
    if (!isGasValid) {
      toast("error", "Please set valid gas settings first", mdiAlertOutline);
      return;
    }

    if (availableBalance < maxGasFee) {
      toast(
        "error",
        "You don't have enough DUSK to cover the transaction fee",
        mdiAlertOutline
      );
      return;
    }

    withdrawAmount = luxToDusk(maxWithdrawAmount);
    isAmountChosen = true;
  }

  /** @param {Event} event */
  function setWithdrawAmount(event) {
    withdrawAmount = /** @type {HTMLInputElement} */ (event.currentTarget)
      .valueAsNumber;
    isAmountChosen = true;
  }

  onMount(() => {
    isGasValid = areValidGasSettings(gasPrice, gasLimit, gasLimits);
  });

  $: withdrawAmountInLux = withdrawAmount ? duskToLux(withdrawAmount) : 0n;
  $: ({ hideBalances, language } = $settingsStore);
  $: isAmountHidden = hideBalances && !isAmountChosen;

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

  // Check if the available balance is sufficient to cover the max gas fee.
  // This is a prerequisite for any transaction.
  $: isBalanceSufficientForGas = availableBalance >= maxGasFee;

  // Validate that the unstake amount is within allowable limits:
  // - If unstaking, the remaining amount after unstaking must be at least the minimum stake requirement.
  // - If unstaking everything, the above condition is not applicable.
  // - At most the maximum amount available to withdraw
  $: isWithdrawAmountValid =
    minStakeRequirement !== undefined
      ? (withdrawAmountInLux === maxWithdrawAmount ||
          maxWithdrawAmount - withdrawAmountInLux >= minStakeRequirement) &&
        withdrawAmountInLux <= maxWithdrawAmount
      : withdrawAmountInLux <= maxWithdrawAmount;

  $: isNextButtonDisabled = !(
    isWithdrawAmountValid &&
    isGasValid &&
    isBalanceSufficientForGas
  );
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
        action: () => activeStep++,
        disabled: isNextButtonDisabled,
      }}
    >
      <div class="operation__amount-wrapper">
        <p>Amount:</p>
        <Button
          size="small"
          variant="tertiary"
          on:click={setMaxAmount}
          text="Use max"
        />
      </div>

      <div class="operation__input-wrapper">
        <Textbox
          className="operation__input-field"
          value={isAmountHidden ? "" : withdrawAmount}
          placeholder={isAmountHidden ? BALANCE_MASK : undefined}
          aria-describedby={isAmountHidden ? hiddenNoteId : undefined}
          on:input={setWithdrawAmount}
          type="number"
          min={minStakeRequirement !== undefined
            ? maxWithdrawAmount - withdrawAmountInLux >= minStakeRequirement
            : undefined}
          max={luxToDusk(maxWithdrawAmount)}
          required
          step="0.000000001"
        />
        <DuskIcon />
        {#if isAmountHidden}
          <span hidden id={hiddenNoteId}>hidden</span>
        {/if}
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

      {#if !isBalanceSufficientForGas}
        <Banner variant="error" title="Insufficient balance for gas fees">
          <p>Add funds or lower the gas limit.</p>
        </Banner>
      {:else if withdrawAmountInLux > maxWithdrawAmount}
        <Banner
          variant="error"
          title="Withdraw amount exceeds available balance"
        />
      {:else if minStakeRequirement && maxWithdrawAmount !== withdrawAmountInLux && maxWithdrawAmount - withdrawAmountInLux < minStakeRequirement}
        <Banner
          variant="error"
          title="Remaining staked amount below minimum requirement"
        >
          <p>
            Leave at least {formatDusk(minStakeRequirement, language)} DUSK staked,
            or unstake it all.
          </p>
        </Banner>
      {/if}
    </WizardStep>

    <!-- OPERATION OVERVIEW STEP  -->
    <WizardStep
      step={1}
      {key}
      backButton={{
        action: () => activeStep--,
        disabled: false,
      }}
      nextButton={{
        action: () => activeStep++,
        icon: {
          path: operationCtaIconPath,
          position: "before",
        },
        label: operationCtaLabel,
        variant: "primary",
      }}
    >
      <div in:fade|global class="operation__unstake">
        <ReviewWallet />
        <ReviewAmount
          label={operationOverviewLabel}
          value={formatDuskExact(withdrawAmountInLux, language)}
        />
        <ReviewAmount
          label="Network fee (at most)"
          value={formatFee(maxGasFee, language, { max: true })}
        />
      </div>
    </WizardStep>

    <!-- OPERATION RESULT STEP  -->
    <WizardStep step={2} {key} showNavigation={false}>
      <TransactionResult
        leaveHref="/dashboard/stake"
        leaveText="Back to staking"
        maxFee={maxGasFee}
        onBeforeLeave={resetOperation}
        operation={execute(withdrawAmountInLux, gasPrice, gasLimit)}
      />
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

    &__amount-wrapper,
    &__input-wrapper {
      display: flex;
      align-items: center;
      width: 100%;
    }

    &__amount-wrapper {
      justify-content: space-between;
    }

    &__input-wrapper {
      column-gap: var(--default-gap);
    }
  }
</style>
