<script>
  import { mdiEyeOffOutline, mdiEyeOutline } from "@mdi/js";
  import { Icon } from "$lib/dusk/components";
  import { BalanceValue } from "$lib/components";
  import {
    createCurrencyFormatter,
    formatDusk,
    formatDuskExact,
    luxToDusk,
  } from "$lib/dusk/currency";
  import { settingsStore } from "$lib/stores";

  /** @type {bigint} */
  export let shielded;

  /** @type {bigint} */
  export let unshielded;

  /**
   * What is staked, natively and with Sozu, which the total leaves out.
   *
   * @type {bigint}
   */
  export let staked = 0n;

  /** @type {string} */
  export let locale;

  /** @type {string} */
  export let fiatCurrency;

  /** @type {number | undefined} */
  export let fiatPrice = undefined;

  $: total = shielded + unshielded;
  $: publicShare = total ? Number((unshielded * 1000n) / total) / 10 : 100;
  $: hideBalances = $settingsStore.hideBalances === true;
  $: toggleLabel = hideBalances ? "Show balances" : "Hide balances";
  $: fiat =
    fiatPrice === undefined
      ? ""
      : createCurrencyFormatter(
          locale,
          fiatCurrency,
          2
        )(luxToDusk(total) * fiatPrice);

  function toggleBalances() {
    settingsStore.update((store) => ({
      ...store,
      hideBalances: !store.hideBalances,
    }));
  }
</script>

<section aria-labelledby="home-balance-label" class="home-balance">
  <div class="home-balance__label">
    <h2 class="ledger-label" id="home-balance-label">Total balance</h2>
    <!-- Named for what it does next. -->
    <button
      aria-label={toggleLabel}
      class="home-balance__toggle"
      data-tooltip-id="main-tooltip"
      data-tooltip-text={toggleLabel}
      on:click={toggleBalances}
      type="button"
    >
      <Icon path={hideBalances ? mdiEyeOffOutline : mdiEyeOutline} />
    </button>
  </div>
  <p class="home-balance__total">
    <span class="home-balance__amount"
      ><BalanceValue
        exact={formatDuskExact(total, locale)}
        value={formatDusk(total, locale)}
      /></span
    >
    <span class="home-balance__unit">DUSK</span>
  </p>
  {#if fiat}
    <p class="home-balance__fiat">≈ <BalanceValue value={fiat} /></p>
  {/if}
  {#if staked > 0n}
    <p class="home-balance__staked">
      Staked <BalanceValue
        exact={formatDuskExact(staked, locale)}
        value={formatDusk(staked, locale)}
      /> DUSK
    </p>
  {/if}
  <div aria-hidden="true" class="home-balance__bar">
    <i class="home-balance__bar-public" style:flex-grow={publicShare}></i>
    <i class="home-balance__bar-shielded" style:flex-grow={100 - publicShare}
    ></i>
  </div>
  <p class="home-balance__legend">
    <span
      ><i class="home-balance__key home-balance__key--public"></i><span
        class="ledger-label">Public</span
      >
      <b
        ><BalanceValue
          exact={formatDuskExact(unshielded, locale)}
          value={formatDusk(unshielded, locale)}
        /></b
      ></span
    >
    <span
      ><i class="home-balance__key home-balance__key--shielded"></i><span
        class="ledger-label">Shielded</span
      >
      <b
        ><BalanceValue
          exact={formatDuskExact(shielded, locale)}
          value={formatDusk(shielded, locale)}
        /></b
      ></span
    >
  </p>
</section>

<style lang="postcss">
  .home-balance__label {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    color: var(--calm-muted);
  }

  .home-balance__toggle {
    all: unset;
    display: grid;
    place-items: center;
    width: 2rem;
    height: 2rem;
    border-radius: 50%;
    color: var(--calm-subtle);
    cursor: pointer;

    & :global(.dusk-icon) {
      width: 1rem;
      height: 1rem;
    }

    &:hover {
      color: var(--calm-text);
    }

    &:focus-visible {
      outline: 2px solid var(--calm-focus);
    }
  }

  .home-balance__total {
    display: flex;
    align-items: baseline;
    flex-wrap: wrap;
    gap: 0.625rem;
    margin-top: 0.25rem;
    font-variant-numeric: tabular-nums;
  }

  .home-balance__amount {
    font-size: clamp(2.625rem, 6vw, 4rem);
    line-height: 1.04;
    letter-spacing: -0.015em;
    overflow-wrap: anywhere;
  }

  .home-balance__unit {
    color: var(--calm-muted);
    font-size: clamp(1.125rem, 2vw, 1.5rem);
  }

  .home-balance__fiat,
  .home-balance__staked {
    margin-top: 0.25rem;
    color: var(--calm-muted);
    font-size: 0.875rem;
    font-variant-numeric: tabular-nums;
  }

  .home-balance__bar {
    display: flex;
    gap: 3px;
    max-width: 35rem;
    height: 6px;
    margin-top: 1.125rem;
    border-radius: 3px;
    overflow: hidden;

    & i {
      display: block;
      min-width: 3px;
      border-radius: 3px;
    }
  }

  .home-balance__bar-public,
  .home-balance__key--public {
    background: var(--calm-text);
    opacity: 0.85;
  }

  .home-balance__bar-shielded,
  .home-balance__key--shielded {
    background: var(--calm-subtle);
    opacity: 0.6;
  }

  .home-balance__legend {
    display: flex;
    flex-wrap: wrap;
    gap: 0.375rem 1.375rem;
    margin-top: 0.625rem;
    color: var(--calm-muted);
    font-size: 0.84375rem;
    font-variant-numeric: tabular-nums;

    & span {
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
    }

    & b {
      color: var(--calm-text);
      font-weight: 400;
    }
  }

  .home-balance__key {
    display: inline-block;
    width: 8px;
    height: 8px;
    border-radius: 2px;
  }
</style>
