<svelte:options immutable={true} />

<script>
  import { makeClassName } from "$lib/dusk/string";
  import { createCurrencyFormatter, luxToDusk } from "$lib/dusk/currency";
  import { Icon } from "$lib/dusk/components";
  import {
    mdiEyeOffOutline,
    mdiEyeOutline,
    mdiShieldLock,
    mdiShieldLockOpenOutline,
  } from "@mdi/js";
  import { logo } from "$lib/dusk/icons";
  import { createNumberFormatter } from "$lib/dusk/number";
  import { BalanceValue } from "$lib/components";
  import { settingsStore } from "$lib/stores";

  import "./Balance.css";

  /** @type {string | undefined} */
  export let className = undefined;

  /** @type {string} */
  export let fiatCurrency;

  /** @type {number | undefined} */
  export let fiatPrice = undefined;

  /**
   * A BCP 47 language tag.
   * @type {string}
   */
  export let locale;

  /** @type {string} */
  export let tokenCurrency;

  /** @type {bigint} */
  export let shieldedAmount;

  /** @type {bigint} */
  export let unshieldedAmount;

  $: totalBalance = luxToDusk(shieldedAmount + unshieldedAmount);

  $: shieldedPercentage = totalBalance
    ? (luxToDusk(shieldedAmount) / totalBalance) * 100
    : 0;

  $: unshieldedPercentage = totalBalance
    ? (luxToDusk(unshieldedAmount) / totalBalance) * 100
    : 0;

  $: classes = makeClassName(["dusk-balance", className]);

  $: hideBalances = $settingsStore.hideBalances === true;

  function toggleBalances() {
    settingsStore.update((store) => ({
      ...store,
      hideBalances: !store.hideBalances,
    }));
  }

  $: duskFormatter = createCurrencyFormatter(locale, tokenCurrency, 9);
  $: fiatFormatter = createCurrencyFormatter(locale, fiatCurrency, 2);
  $: numberFormatter = createNumberFormatter(locale, 2);
</script>

<article {...$$restProps} class={classes}>
  <header class="dusk-balance__header">
    <div class="dusk-balance__heading">
      <h2 class="dusk-balance__label">Total balance</h2>
      <button
        aria-label="Hide balances"
        aria-pressed={hideBalances}
        class="dusk-balance__toggle"
        data-tooltip-id="main-tooltip"
        data-tooltip-text="Hide balances"
        on:click={toggleBalances}
        type="button"
      >
        <Icon path={hideBalances ? mdiEyeOffOutline : mdiEyeOutline} />
      </button>
    </div>
    <p
      class="dusk-balance__fiat"
      class:dusk-balance__fiat--visible={fiatPrice !== undefined}
    >
      <span>
        <BalanceValue
          value={fiatFormatter(fiatPrice ? fiatPrice * totalBalance : 0)}
        />
      </span>
    </p>
  </header>
  <p class="dusk-balance__dusk">
    <span><BalanceValue value={duskFormatter(totalBalance)} /></span>
    <span>{tokenCurrency}</span>
  </p>

  <div class="dusk-balance__usage-details">
    <div class="dusk-balance__account">
      <span class="dusk-balance__percentage"
        ><Icon path={mdiShieldLockOpenOutline} /><span>Public</span><span
          ><BalanceValue
            value={`${numberFormatter(unshieldedPercentage)}%`}
          /></span
        ></span
      >
      <span class="dusk-balance__value"
        ><BalanceValue
          value={duskFormatter(luxToDusk(unshieldedAmount))}
        /><Icon
          data-tooltip-id="main-tooltip"
          data-tooltip-text="DUSK"
          path={logo}
        /></span
      >
    </div>
    <div class="dusk-balance__account">
      <span class="dusk-balance__percentage"
        ><Icon path={mdiShieldLock} /><span>Shielded</span><span
          ><BalanceValue
            value={`${numberFormatter(shieldedPercentage)}%`}
          /></span
        ></span
      >
      <span class="dusk-balance__value"
        ><BalanceValue value={duskFormatter(luxToDusk(shieldedAmount))} /><Icon
          data-tooltip-id="main-tooltip"
          data-tooltip-text="DUSK"
          path={logo}
        /></span
      >
    </div>
  </div>
</article>
