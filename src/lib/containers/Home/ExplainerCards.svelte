<script>
  import {
    mdiChevronRight,
    mdiEyeOffOutline,
    mdiEyeOutline,
    mdiLayersOutline,
  } from "@mdi/js";
  import { Icon } from "$lib/dusk/components";
  import { BalanceValue } from "$lib/components";
  import { formatLux } from "$lib/activity/present";
  import { addBasePath } from "$lib/navigation";

  /** @type {bigint} */
  export let shielded;

  /** @type {bigint} */
  export let unshielded;

  /**
   * What is staked now, rewards aside, or null for nothing.
   *
   * @type {bigint | null}
   */
  export let staked;

  /** @type {bigint} */
  export let reward;

  /** @type {bigint} */
  export let minimumStake;

  /** Whether the history holds staking: an empty stake then isn't "yet". */
  export let hasPastStaking = false;

  export let stakeEnabled = true;

  /** @type {string} */
  export let locale;
</script>

<ul aria-label="Your balances" class="explainer-cards">
  <li class="explainer-card">
    <p class="explainer-card__key"><Icon path={mdiEyeOutline} />Public</p>
    <p class="explainer-card__value">
      <BalanceValue value={formatLux(unshielded, locale)} />
      <span class="explainer-card__unit">DUSK</span>
    </p>
    <p class="explainer-card__text">
      Visible on chain. Staking and the bridge use this balance.
    </p>
  </li>
  <li class="explainer-card">
    <p class="explainer-card__key">
      <Icon path={mdiEyeOffOutline} />Shielded
    </p>
    <p class="explainer-card__value">
      <BalanceValue value={formatLux(shielded, locale)} />
      <span class="explainer-card__unit">DUSK</span>
    </p>
    <p class="explainer-card__text">
      Amounts and accounts stay hidden on chain.
    </p>
  </li>
  {#if stakeEnabled}
    <li class="explainer-card">
      <p class="explainer-card__key">
        <Icon path={mdiLayersOutline} />Staking
      </p>
      {#if staked}
        <p class="explainer-card__value">
          <BalanceValue value={formatLux(staked, locale)} />
          <span class="explainer-card__unit">DUSK staked</span>
        </p>
        <p class="explainer-card__text">
          Rewards: <BalanceValue value={formatLux(reward, locale)} /> DUSK
        </p>
      {:else}
        <p class="explainer-card__value explainer-card__value--text">
          Nothing staked right now
        </p>
        <p class="explainer-card__text">
          From {formatLux(minimumStake, locale, { minimumFractionDigits: 0 })}
          DUSK with your own node.
        </p>
        {#if hasPastStaking}
          <a
            class="explainer-card__link explainer-card__link--secondary"
            href={addBasePath("/dashboard/transactions?kind=staking")}
            >Past staking</a
          >
        {/if}
      {/if}
      <a class="explainer-card__link" href={addBasePath("/dashboard/stake")}
        >Open staking <Icon path={mdiChevronRight} /></a
      >
    </li>
  {/if}
</ul>

<style lang="postcss">
  .explainer-cards {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr));
    gap: 1rem;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .explainer-card {
    display: flex;
    flex-direction: column;
    padding: 1.125rem 1.25rem 1.25rem;
    border: 1px solid var(--calm-line2);
    border-radius: 1rem;
  }

  .explainer-card__key {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    color: var(--calm-muted);
    font-size: 0.84375rem;

    & :global(.dusk-icon) {
      width: 1rem;
      height: 1rem;
    }
  }

  /* A long amount puts its unit on the next line, at the left edge. */
  .explainer-card__value {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    column-gap: 0.375rem;
    margin-top: 0.625rem;
    font-size: 1.5rem;
    font-variant-numeric: tabular-nums;

    &--text {
      font-size: 1.125rem;
    }
  }

  .explainer-card__unit {
    color: var(--calm-muted);
    font-size: 0.9375rem;
  }

  /* Body contrast: what a balance means is not small print. */
  .explainer-card__text {
    margin-top: 0.5rem;
    color: var(--calm-text);
    font-size: 0.8125rem;
    line-height: 1.45;
  }

  .explainer-card__link {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    align-self: flex-start;
    margin-top: auto;
    padding-top: 0.875rem;
    min-height: 44px;
    color: var(--calm-text);
    font-size: 0.84375rem;
    font-weight: 500;
    text-decoration: none;

    &--secondary {
      margin-top: 0.25rem;
      padding-top: 0;
      color: var(--calm-muted);
      text-decoration: underline;
      text-underline-offset: 3px;
    }

    & :global(.dusk-icon) {
      width: 0.9375rem;
      height: 0.9375rem;
    }

    &:focus-visible {
      outline: 2px solid var(--calm-focus);
      outline-offset: 2px;
    }
  }
</style>
