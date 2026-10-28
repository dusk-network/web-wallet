<svelte:options immutable={true} />

<script>
  import { fade } from "svelte/transition";
  import { onMount } from "svelte";
  import {
    mdiArrowUpBoldBoxOutline,
    mdiShieldLock,
    mdiShieldLockOpenOutline,
  } from "@mdi/js";

  import { areValidGasSettings, followDefaultGas } from "$lib/contracts";
  import {
    formatDusk,
    formatDuskExact,
    formatDuskPlain,
    formatFee,
  } from "$lib/dusk/currency";
  import { getDecimalSeparator } from "$lib/dusk/number";
  import {
    calculateAdaptiveCharCount,
    middleEllipsis,
    randomUUID,
  } from "$lib/dusk/string";
  import {
    Badge,
    Icon,
    Textbox,
    Wizard,
    WizardStep,
  } from "$lib/dusk/components";
  import {
    BalanceValue,
    DuskIcon,
    GasSettings,
    ReviewAmount,
    TransactionResult,
  } from "$lib/components";
  import { settingsStore, walletStore } from "$lib/stores";
  import { Gas } from "@dusk/w3sper";
  import { BALANCE_MASK } from "$lib/constants";
  import Banner from "../Banner/Banner.svelte";
  import { normalizeDuskInput, parseDuskInput } from "../Stake/stakeAmount";

  /** @type {ContractGasSettings} */
  export let gasSettings;

  /** @type {GasStoreContent} */
  export let gasLimits;

  /** @type {string} */
  export let shieldedAddress;

  /** @type {string} */
  export let unshieldedAddress;

  /** @type {AddressBalance} */
  export let shieldedBalance;

  /** @type {bigint} */
  export let unshieldedBalance;

  /**
   * An amount as its field shows it: every decimal, with the language's
   * decimal separator and no grouping.
   *
   * @param {bigint} lux
   */
  const fieldText = (lux) =>
    formatDuskPlain(lux).replace(".", getDecimalSeparator());

  /**
   * Takes the amount typed in one field, with a decimal point or comma, and
   * shows what's left in the other.
   *
   * @param {Event} event
   */
  function handleBalanceChange(event) {
    const { name, value } = /** @type {HTMLInputElement} */ (event.target);
    const lux = parseDuskInput(
      normalizeDuskInput(value, getDecimalSeparator())
    );
    const isShieldedAmount = name === "shielded-amount";

    typedAmount = name;

    if (isShieldedAmount) {
      shieldedText = value;
    } else {
      unshieldedText = value;
    }

    if (lux === null) {
      hasInvalidInput = true;
      return;
    }

    hasInvalidInput = false;
    shielded = isShieldedAmount ? lux : totalBalance - lux;

    if (isShieldedAmount) {
      unshieldedText = fieldText(totalBalance - lux);
    } else {
      shieldedText = fieldText(totalBalance - lux);
    }
  }

  async function allocate() {
    const gas = new Gas({ limit: gasLimit, price: gasPrice });

    if (difference !== 0n) {
      const transactionInfo = isShielding
        ? await walletStore.shield(difference, gas)
        : await walletStore.unshield(-difference, gas);

      return transactionInfo.hash;
    }

    // We shouldn't end up in this case,
    // as the next button should be disabled
    return Promise.resolve();
  }

  onMount(() => {
    isGasValid = areValidGasSettings(gasPrice, gasLimit, gasLimits);

    const resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0];

      screenWidth = entry.contentRect.width;
    });

    resizeObserver.observe(document.body);

    return () => resizeObserver.disconnect();
  });

  /** @type {boolean} */
  let isNextButtonDisabled = false;

  /** @type {boolean} */
  let isGasValid = false;

  let { gasLimit, gasPrice } = gasSettings;

  /** Whether the first step, where the gas can be edited, shows. */
  let isEditing = true;

  let defaultGas = gasSettings;

  /** @type {number} */
  let screenWidth = window.innerWidth;

  let hasInvalidInput = false;

  /**
   * The amount the user last typed. While balances are hidden, it shows,
   * and the other one, what is left of the balance, stays hidden.
   *
   * @type {string}
   */
  let typedAmount = "";

  // What screen readers read with an amount field that is hidden.
  const hiddenNoteId = `${randomUUID()}-hidden-note`;

  // Constant total
  const totalBalance = shieldedBalance.spendable + unshieldedBalance;

  // Used to keep the difference between the initial shielded balance and the current one
  const initialShielded = shieldedBalance.spendable;

  // Internal state of the balances
  let shielded = shieldedBalance.spendable;
  $: unshielded = totalBalance - shielded;

  // What each field shows: as typed in the one typed in, what's left in the
  // other.
  let shieldedText = fieldText(shielded);
  let unshieldedText = fieldText(totalBalance - shielded);

  $: ({ hideBalances, language } = $settingsStore);
  $: isShieldedHidden = hideBalances && typedAmount !== "shielded-amount";
  $: isUnshieldedHidden = hideBalances && typedAmount !== "unshielded-amount";

  $: isShielding = difference > 0n;
  $: amount = isShielding ? difference : -difference;

  $: fee = gasLimit * gasPrice;
  $: difference = shielded - initialShielded;

  // The default gas can change while the form is open, as when the node's
  // price arrives: the form takes it while its gas can be edited, unless it
  // was edited here, and keeps the gas a review shows.
  $: if (isEditing && gasSettings !== defaultGas) {
    ({ gasLimit, gasPrice } = followDefaultGas(
      { gasLimit, gasPrice },
      defaultGas,
      gasSettings
    ));
    defaultGas = gasSettings;
    isGasValid = areValidGasSettings(gasPrice, gasLimit, gasLimits);
  }

  $: hasEnoughFundsForFees =
    difference === 0n ||
    (isShielding
      ? unshieldedBalance - difference - fee >= 0n
      : shieldedBalance.spendable + difference - fee >= 0n);
  $: fundsErrorMessage = hasEnoughFundsForFees
    ? ""
    : shielded < 0n || unshielded < 0n
      ? "The amount is more than your balance."
      : "Your balance is too low to cover the allocation fees.";

  $: isNextButtonDisabled =
    !hasEnoughFundsForFees ||
    !isGasValid ||
    difference === 0n || // No change in balance
    shielded < 0n || // Shielded balance is negative
    unshielded < 0n || // Unshielded balance is negative
    shielded + unshielded > totalBalance ||
    hasInvalidInput;
</script>

<div class="operation">
  <Wizard steps={3} let:key>
    <WizardStep
      step={0}
      {key}
      backButton={{
        disabled: false,
        href: "/dashboard",
        isAnchor: true,
      }}
      nextButton={{
        action: () => {
          isEditing = false;
        },
        disabled: isNextButtonDisabled,
      }}
    >
      <div in:fade|global class="operation__allocate">
        <p>Move DUSK between your public and shielded accounts.</p>

        <fieldset class="operation__fieldset">
          <p class="operation__label">Public</p>

          <div class="operation__address-wrapper">
            <Icon path={mdiShieldLockOpenOutline} />
            {middleEllipsis(
              unshieldedAddress,
              calculateAdaptiveCharCount(screenWidth, 320, 640, 5, 20)
            )}
          </div>

          <div class="operation__input-wrapper">
            <Textbox
              className="operation__input-field"
              value={isUnshieldedHidden ? "" : unshieldedText}
              placeholder={isUnshieldedHidden ? BALANCE_MASK : undefined}
              aria-describedby={isUnshieldedHidden ? hiddenNoteId : undefined}
              autocomplete="off"
              required
              type="text"
              inputmode="decimal"
              id="unshielded-amount"
              on:input={handleBalanceChange}
              name="unshielded-amount"
              aria-label="Public amount"
            />
            <DuskIcon />
          </div>

          <hr class="glyph" />

          <p class="operation__label">
            Shielded<br />
            <small
              >(<BalanceValue
                exact={formatDuskExact(shieldedBalance.spendable, language)}
                value={formatDusk(shieldedBalance.spendable, language)}
              />
              spendable out of
              <BalanceValue
                exact={formatDuskExact(shieldedBalance.value, language)}
                value={formatDusk(shieldedBalance.value, language)}
              /> total)</small
            >
          </p>

          <div class="operation__address-wrapper">
            <Icon path={mdiShieldLock} />
            {middleEllipsis(
              shieldedAddress,
              calculateAdaptiveCharCount(screenWidth, 320, 640, 5, 20)
            )}
          </div>

          <div class="operation__input-wrapper">
            <Textbox
              className="operation__input-field"
              value={isShieldedHidden ? "" : shieldedText}
              placeholder={isShieldedHidden ? BALANCE_MASK : undefined}
              aria-describedby={isShieldedHidden ? hiddenNoteId : undefined}
              autocomplete="off"
              required
              type="text"
              inputmode="decimal"
              on:input={handleBalanceChange}
              name="shielded-amount"
              aria-label="Shielded amount"
            />
            <DuskIcon />
          </div>
          {#if hideBalances}
            <span hidden id={hiddenNoteId}>hidden</span>
          {/if}
        </fieldset>

        <GasSettings
          {fee}
          limit={gasLimit}
          limitLower={gasLimits.gasLimitLower}
          limitUpper={gasLimits.gasLimitUpper}
          price={gasPrice}
          priceLower={gasLimits.gasPriceLower}
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
        />

        {#if fundsErrorMessage}
          <Banner title="Insufficient Funds" variant="error">
            <p>{fundsErrorMessage}</p>
          </Banner>
        {/if}
      </div>
    </WizardStep>
    <WizardStep
      step={1}
      {key}
      backButton={{
        action: () => {
          isEditing = true;
        },
      }}
      nextButton={{
        icon: { path: mdiArrowUpBoldBoxOutline, position: "before" },
        label: "Send",
        variant: "primary",
      }}
    >
      <div in:fade|global class="operation__allocate">
        <Badge
          className="operation__review-notice"
          text="Review transaction"
          variant="warning"
        />
        <ReviewAmount
          label="Amount"
          value={formatDuskExact(amount, language)}
        />
        <dl class="operation__review-transaction">
          <dt class="review-transaction__label">
            <span>From</span>
          </dt>
          <dd class="operation__review-address">
            <span>
              {isShielding ? unshieldedAddress : shieldedAddress}
            </span>
          </dd>
        </dl>
        <dl class="operation__review-transaction">
          <dt class="review-transaction__label">
            <span>To</span>
          </dt>
          <dd class="operation__review-address">
            <span>
              {isShielding ? shieldedAddress : unshieldedAddress}
            </span>
          </dd>
        </dl>
        <ReviewAmount
          label="Network fee (at most)"
          value={formatFee(fee, language, { max: true })}
        />
        <ReviewAmount
          label="Total (at most)"
          value={formatFee(amount + fee, language, { max: true })}
        />
        <Banner
          title={`The fee is paid from your ${isShielding ? "public" : "shielded"} balance.`}
          variant="info"
        />
      </div>
    </WizardStep>
    <WizardStep step={2} {key} showNavigation={false}>
      <TransactionResult maxFee={fee} operation={allocate()} />
    </WizardStep>
  </Wizard>
</div>

<style lang="postcss">
  .operation {
    &__fieldset {
      display: flex;
      padding: 1em 1.25em;
      flex-direction: column;
      justify-content: center;
      align-items: flex-start;
      gap: var(--medium-gap);
      align-self: stretch;

      border-radius: var(--fieldset-border-radius);
      background: var(--fieldset-background-color);
    }

    &__address-wrapper,
    &__input-wrapper {
      display: flex;
      align-items: center;
      width: 100%;
    }

    &__address-wrapper {
      font-family: var(--mono-font-family);
      justify-content: space-between;
    }

    &__review-address {
      background-color: var(--surface-soft-color);
      border: 1px solid var(--surface-border-color);
      border-radius: var(--control-border-radius-size);
      font-family: var(--mono-font-family);
      font-size: 0.875rem;
      padding: 0.75em 1em;
      width: 100%;
      line-break: anywhere;
    }

    &__review-transaction {
      display: flex;
      flex-direction: column;
      gap: 0.625em;
    }

    &__allocate {
      display: flex;
      flex-direction: column;
      gap: 1.2em;
    }

    &__label {
      font-variant-numeric: tabular-nums;
    }

    &__input-wrapper {
      column-gap: var(--default-gap);
    }

    :global(&__input-field) {
      width: 100%;
    }

    :global(&__review-notice) {
      text-align: center;
    }
  }

  .review-transaction__label {
    display: inline-flex;
    align-items: center;
    gap: var(--small-gap);
  }

  .glyph {
    margin: var(--default-gap) 0;
    height: 1px;
  }

  .glyph:after {
    content: "↑↓";
    display: inline-block;
    position: relative;
    top: -1.2em;
    color: var(--divider-border-color);
    border: 1px solid var(--divider-border-color);
    border-radius: 2em;
    padding: 0.5em 1.25em;
    background-color: var(--divider-background-color);
  }
</style>
