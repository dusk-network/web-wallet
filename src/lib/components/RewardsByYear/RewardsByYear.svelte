<svelte:options immutable={true} />

<script>
  /**
   * Staking rewards by calendar year, as both wallets say them
   * (`@dusk-network/app-core/export`): native staking's claimed, and what
   * Sozu's stDUSK grew while held and what unstaking took out of it, which
   * is part of the growth, as said under them; in DUSK, and in a currency
   * where asked, with what has no value said.
   */
  import { createEventDispatcher } from "svelte";
  import { REWARDS_COUNTED, REWARD_WORDS } from "@dusk-network/app-core/export";

  import { currencyWords } from "$lib/activity/accountantExport";
  import { formatDusk, formatDuskExact } from "$lib/dusk/currency";

  import BalanceValue from "../BalanceValue/BalanceValue.svelte";

  /**
   * The years read, and the currency they're valued in, or null.
   *
   * @type {{ currency: string | null, shieldedWaiting: boolean, years: import("@dusk-network/app-core/export").YearRewards[] }}
   */
  export let rewards;

  /** The currency a value is asked in, as the checkbox says it. */
  export let currency;

  /** Whether each amount is written whole, as a file has it, or as the wallet shows amounts. */
  export let exact = false;

  /** Whether they're asked with their value. */
  export let valued = false;

  export let disabled = false;

  /** @type {string} */
  export let locale;

  const dispatch = createEventDispatcher();

  /**
   * A year's rewards in DUSK, what they were worth where that's asked, and
   * how many of them have no value.
   *
   * @param {import("@dusk-network/app-core/export").RewardsSum} sum
   * @param {string | null} valuedIn The currency they're valued in
   * @returns {{ dusk: string, exactDusk: string, note: string, value: string | null }}
   */
  function rewardParts({ lux, unpriced, worth }, valuedIn) {
    const exactDusk = formatDuskExact(lux, locale);
    const dusk = exact ? exactDusk : formatDusk(lux, locale);

    if (!valuedIn || worth === null) {
      return { dusk, exactDusk, note: "", value: null };
    }

    const { one } = currencyWords(valuedIn);

    if (unpriced && !Number(worth)) {
      return { dusk, exactDusk, note: ` · no ${one} value`, value: null };
    }

    const money = new Intl.NumberFormat(locale || undefined, {
      currency: valuedIn,
      style: "currency",
    });
    // The least it shows, a cent or a yen: less than that, as under it.
    const least = 10 ** -(money.resolvedOptions().maximumFractionDigits ?? 2);
    const amount = Number(worth);

    return {
      dusk,
      exactDusk,
      note: unpriced ? `, ${unpriced} with no ${one} value` : "",
      value:
        amount > 0 && amount < least
          ? `under ${money.format(least)}`
          : money.format(amount),
    };
  }
</script>

{#if rewards.years.length}
  <table class="rewards-by-year">
    <caption>Staking rewards by year</caption>
    <thead>
      <tr>
        <th scope="col">Year</th>
        <th scope="col">{REWARD_WORDS.claimed}</th>
        <th scope="col">{REWARD_WORDS.sozuGrown}</th>
        <th scope="col">{REWARD_WORDS.sozu}</th>
      </tr>
    </thead>
    <tbody>
      {#each rewards.years as { claimed, sozu, sozuGrown, year } (year)}
        <tr>
          <th scope="row">{year}</th>
          {#each [claimed, sozuGrown, sozu] as sum, column (column)}
            {@const parts = sum && rewardParts(sum, rewards.currency)}
            <td>
              {#if parts}
                <BalanceValue exact={parts.exactDusk} value={parts.dusk} /> DUSK{parts.value
                  ? " · "
                  : ""}{#if parts.value}<BalanceValue
                    value={parts.value}
                  />{/if}{parts.note}
              {:else}
                Couldn't be read
              {/if}
            </td>
          {/each}
        </tr>
      {/each}
    </tbody>
  </table>
  <p class="rewards-by-year__note">{REWARDS_COUNTED}</p>
  <label class="rewards-by-year__option">
    <input
      bind:checked={valued}
      class="dusk-checkbox"
      {disabled}
      on:change={() => dispatch("valued", valued)}
      type="checkbox"
    />
    Add each reward's value in {currencyWords(currency).many}, from CoinGecko's
    prices
  </label>
{:else}
  <p class="rewards-by-year__note">No staking rewards yet.</p>
{/if}
{#if rewards.shieldedWaiting}
  <p class="rewards-by-year__note">
    Your shielded activity is still syncing: show them again once it's done.
  </p>
{/if}

<style lang="postcss">
  .rewards-by-year {
    align-self: stretch;
    width: 100%;
    border-collapse: collapse;
    font-size: 0.875rem;
    line-height: 1.4;
    text-align: left;

    & caption {
      margin-bottom: 0.375rem;
      font-weight: 500;
      text-align: left;
    }

    & th,
    & td {
      padding: 0.375rem 0.75rem 0.375rem 0;
      border-top: 1px solid var(--calm-line);
      vertical-align: top;
    }

    & thead th {
      color: var(--calm-muted);
      font-weight: 400;
    }
  }

  .rewards-by-year__note {
    margin: 0;
    color: var(--calm-muted);
    font-size: 0.8125rem;
    line-height: 1.45;
  }

  .rewards-by-year__option {
    display: flex;
    align-items: flex-start;
    gap: 0.5rem;
    font-size: 0.875rem;
    line-height: 1.4;
  }
</style>
