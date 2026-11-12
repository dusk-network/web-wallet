<script>
  import {
    mdiChevronRight,
    mdiEyeOffOutline,
    mdiEyeOutline,
    mdiLayersOutline,
  } from "@mdi/js";
  import { Button, Icon } from "$lib/dusk/components";
  import { BalanceValue } from "$lib/components";
  import { formatDusk, formatDuskExact } from "$lib/dusk/currency";
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

  /** What is staked with Sozu, as far as known. */
  export let liquid = 0n;

  /** Whether this network has Sozu, for staking any amount. */
  export let sozuAvailable = false;

  export let stakeEnabled = true;

  /**
   * Whether what's staked couldn't be read, natively or with Sozu: what shows
   * of it is what was read before, if anything. Unknown isn't nothing.
   */
  export let stakeUnread = false;

  /**
   * Whether the balances couldn't be read: the public one shown is what was
   * read before.
   */
  export let balanceUnread = false;

  /** Whether it's being read, with nothing read before to show meanwhile. */
  export let stakeReading = false;

  /**
   * Reads what's staked again.
   *
   * @type {() => Promise<unknown> | void}
   */
  export let onRetry = () => {};

  /** @type {string} */
  export let locale;

  /** Whether a Try again pressed is still reading. */
  let isRetrying = false;

  function retry() {
    isRetrying = true;
    Promise.resolve(onRetry())
      .catch(() => {})
      .finally(() => {
        isRetrying = false;
      });
  }
</script>

<ul aria-label="Your balances" class="explainer-cards">
  <li class="explainer-card">
    <p class="explainer-card__key ledger-label">
      <Icon path={mdiEyeOutline} />Public
    </p>
    <p class="explainer-card__value">
      <BalanceValue
        exact={formatDuskExact(unshielded, locale)}
        value={formatDusk(unshielded, locale)}
      />
      <span class="explainer-card__unit">DUSK</span>
    </p>
    <p class="explainer-card__text">
      Visible on chain. Staking and the bridge use this balance.
    </p>
    {#if balanceUnread}
      <p class="explainer-card__text">
        It couldn't be read just now. This may be out of date.
      </p>
    {/if}
  </li>
  <li class="explainer-card">
    <p class="explainer-card__key ledger-label">
      <Icon path={mdiEyeOffOutline} />Shielded
    </p>
    <p class="explainer-card__value">
      <BalanceValue
        exact={formatDuskExact(shielded, locale)}
        value={formatDusk(shielded, locale)}
      />
      <span class="explainer-card__unit">DUSK</span>
    </p>
    <p class="explainer-card__text">
      Amounts and accounts stay hidden on chain.
    </p>
  </li>
  {#if stakeEnabled}
    <li class="explainer-card">
      <p class="explainer-card__key ledger-label">
        <Icon path={mdiLayersOutline} />Staking
      </p>
      {#if staked}
        <p class="explainer-card__value">
          <BalanceValue
            exact={formatDuskExact(staked, locale)}
            value={formatDusk(staked, locale)}
          />
          <span class="explainer-card__unit">DUSK staked</span>
        </p>
        <p class="explainer-card__text">
          Rewards: <BalanceValue
            exact={formatDuskExact(reward, locale)}
            value={formatDusk(reward, locale)}
          /> DUSK
        </p>
        {#if liquid > 0n}
          <p class="explainer-card__text">
            With Sozu: <BalanceValue
              exact={formatDuskExact(liquid, locale)}
              value={formatDusk(liquid, locale)}
            /> DUSK
          </p>
        {/if}
      {:else if liquid > 0n}
        <p class="explainer-card__value">
          <BalanceValue
            exact={formatDuskExact(liquid, locale)}
            value={formatDusk(liquid, locale)}
          />
          <span class="explainer-card__unit">DUSK with Sozu</span>
        </p>
        <p class="explainer-card__text">
          Liquid staking through Sozu, a third party.
        </p>
      {:else if stakeUnread}
        <p class="explainer-card__value explainer-card__value--text">
          Your stake couldn't be read
        </p>
      {:else if stakeReading}
        <p class="explainer-card__value explainer-card__value--text">
          Reading your stake…
        </p>
      {:else}
        <p class="explainer-card__value explainer-card__value--text">
          Nothing staked right now
        </p>
        <p class="explainer-card__text">
          From {formatDusk(minimumStake, locale)}
          DUSK with your own node{sozuAvailable
            ? ", or any amount with Sozu (third party)"
            : ""}.
        </p>
        {#if hasPastStaking}
          <a
            class="explainer-card__link explainer-card__link--secondary text-link"
            href={addBasePath("/dashboard/transactions?kind=staking")}
            >Past staking</a
          >
        {/if}
      {/if}
      {#if stakeUnread}
        {#if staked || liquid > 0n}
          <p class="explainer-card__text">
            Your stake couldn't be read just now. This may be out of date.
          </p>
        {/if}
        <Button
          className="explainer-card__retry"
          disabled={isRetrying}
          on:click={retry}
          size="small"
          text={isRetrying ? "Trying again…" : "Try again"}
          variant="secondary"
        />
      {/if}
      <a
        class="explainer-card__link text-link"
        href={addBasePath("/dashboard/stake")}
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

  .explainer-card :global(.explainer-card__retry) {
    align-self: flex-start;
    margin-top: 0.75rem;
  }

  .explainer-card__link {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    align-self: flex-start;
    margin-top: auto;
    padding-top: 0.875rem;
    min-height: 44px;
    font-size: 0.84375rem;
    font-weight: 500;
    text-decoration: none;

    &--secondary {
      margin-top: 0.25rem;
      padding-top: 0;
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
