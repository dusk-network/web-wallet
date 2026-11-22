<script>
  import {
    mdiChevronDown,
    mdiChevronRight,
    mdiOpenInNew,
    mdiServerOutline,
    mdiWaterOutline,
  } from "@mdi/js";

  import { lastReadText } from "$lib/activity/present";
  import { DOCUMENTATION_LINKS } from "$lib/constants";
  import { formatDusk, formatDuskExact } from "$lib/dusk/currency";
  import { Button, Icon } from "$lib/dusk/components";
  import {
    AppAnchor,
    AppAnchorButton,
    BalanceValue,
    RewardsByYear,
    SectionHead,
  } from "$lib/components";
  import { goto, pageTitle } from "$lib/navigation";
  import { SOZU_URL } from "$lib/sozu/config";
  import { sozuRate as sozuRateOf } from "@dusk-network/app-core/sozu";
  import { duskPerStDusk, feePercent } from "@dusk-network/networks/sozu";
  import { ratePercent } from "$lib/staking/rewardRate";
  import { settingsStore } from "$lib/stores";

  import ActivityPanel from "../Home/ActivityPanel.svelte";
  import { stakeActions } from "./stakeActions";

  /**
   * Staking at a glance: what is staked, its rewards and what can be
   * staked; Unstake and Claim rewards, with why they can't be pressed; and
   * the two ways to stake side by side, neither picked for you. Beside it,
   * the staking in the history.
   */

  /** @type {StakeInfo} */
  export let stakeInfo;

  /** @type {bigint} */
  export let publicBalance;

  /** @type {bigint} */
  export let minimumStake;

  /** The most an unstake or a claim costs. */
  /** @type {bigint} */
  export let maxFee;

  /**
   * The least an unstake or a claim can be made to cost, in its form.
   *
   * @type {bigint | undefined}
   */
  export let leastFee = undefined;

  /** Whether the history holds staking. */
  export let hasPastStaking = false;

  /** Whether a staking transaction sent from here is still pending. */
  export let pending = false;

  /**
   * Whether the stake wasn't read again after a staking transaction sent
   * from here: what shows may be out of date.
   */
  export let stale = false;

  /** What was read from Sozu, and whether this network has it. */
  /** @type {import("$lib/sozu/sozuStore").SozuState} */
  export let sozu;

  /** @type {string} */
  export let locale;

  /** The history, for the staking in it; null without one. */
  /** @type {import("$lib/activity/activitySession").ActivityState | null} */
  export let activity = null;

  /**
   * All of the history, which the staking in it is read from, not only the
   * page History has shown so far; null without one.
   *
   * @type {import("$lib/activity").WholeActivity | null}
   */
  export let wholeActivity = null;

  /** @type {() => void} */
  export let onRetryHistory = () => {};

  /** Reads Sozu again, after it couldn't be read. */
  /** @type {() => void} */
  export let onRetrySozu = () => {};

  /** Whether the stake couldn't be read: what shows is what was read before. */
  export let stakeReadFailed = false;

  /**
   * When the stake was last read: said with what may be out of date. Null
   * where that isn't known.
   *
   * @type {number | null}
   */
  export let stakeReadAt = null;

  /** The chain's height, once known. */
  /** @type {bigint | undefined} */
  export let blockHeight = undefined;

  /**
   * About what native staking pays a year across the network, as a fraction:
   * measured over `nativeDays`, or else estimated from what a block mints and
   * what's staked now; null or undefined while it isn't known.
   *
   * @type {number | null | undefined}
   */
  export let nativeRate = undefined;

  /**
   * Over how many days back native staking's rate was measured: null for one
   * estimated.
   *
   * @type {number | null}
   */
  export let nativeDays = null;

  /**
   * How Sozu's stDUSK grew lately, as its form has it; null while it isn't
   * read.
   *
   * @type {import("@dusk-network/app-core/sozu").SozuGrowth | null}
   */
  export let sozuGrowth = null;

  /**
   * Staking rewards by year, as Export gives them: none while they aren't
   * read, or where the history has no staking.
   *
   * @type {{ currency: string | null, shieldedWaiting: boolean, years: import("@dusk-network/app-core/export").YearRewards[] } | null}
   */
  export let rewards = null;

  /** The currency their value is asked in. */
  export let rewardsCurrency = "USD";

  /** Whether they're read with their value. */
  export let rewardsValued = false;

  /** Whether DUSK has a price on the network: test DUSK has no value. */
  export let rewardsPriced = true;

  /** @param {bigint} lux */
  const amountOf = (lux) => ({
    exact: formatDuskExact(lux, locale),
    value: formatDusk(lux, locale),
  });

  $: staked = stakeInfo.amount?.total ?? 0n;
  $: locked = stakeInfo.amount?.locked ?? 0n;
  $: hasStake = stakeInfo.amount !== null;
  $: actions = stakeActions({
    leastFee,
    hasLiquid,
    hasPastStaking,
    hidden: $settingsStore.hideBalances,
    locale,
    maxFee,
    pending,
    publicBalance,
    reward: stakeInfo.reward,
    staked,
  });
  // As read now, or else as read last here: what couldn't be read isn't
  // nothing.
  $: position = sozu.status?.position ?? sozu.kept ?? null;
  // Until a read gets through: one under way is trying again.
  $: isSozuUnread = sozu.error !== null;
  $: hasLiquid =
    position !== null && (position.balance > 0n || position.stDusk > 0n);
  $: rate = duskPerStDusk(sozu.status?.pool ?? null);
  // Sozu's fees, as its substrate gives them, where they could be read.
  $: fees = sozu.status?.fees ?? null;
  // What Sozu pays a year, after its share: how stDUSK grew lately, else from
  // the native figure as it's shown, as its form says it.
  $: sozuRate = sozuRateOf(nativeRate, sozu.status, sozuGrowth);
  // Over what each was measured: Sozu's by how its stDUSK grew, else as the
  // native rate it's worked out from.
  $: sozuDays = sozuGrowth?.days ?? nativeDays;
  // No deposits while Sozu is under maintenance, or while that can't be
  // checked.
  $: sozuMaintenance = sozu.status?.flags?.maintenance;
  $: isSozuPaused = sozuMaintenance === true;
  $: isSozuUnchecked =
    Boolean(sozu.status) &&
    sozuMaintenance !== true &&
    sozuMaintenance !== false;

  /** @param {number | null | undefined} days */
  const periodOf = (days) =>
    days ? `over the last ${days} days` : "estimated across the network";

  /**
   * A link can't be disabled: one focused as a transaction went pending still
   * takes Enter, and goes nowhere.
   *
   * @param {Event} event
   */
  const notWhilePending = (event) => {
    if (pending) {
      event.preventDefault();
    }
  };

  // On a phone the comparison waits behind its button: the choices say what
  // tells them apart.
  let isComparisonOpen = false;

  /** @type {{ action?: "claim" | "unstake" | "unstakeSozu", id: string, label: string, lux: bigint, stDusk?: bigint, sub?: string }[]} */
  // What is staked comes first, natively and with Sozu. With nothing
  // natively staked, the native stake says there's nothing to unstake or
  // claim, away from Unstake from Sozu; its rewards are the native stake's,
  // as Sozu's are in what is staked there.
  $: figures = [
    {
      action: hasNative ? "unstake" : undefined,
      id: "staked",
      label: hasLiquid ? "Staked natively" : "Staked",
      lux: staked,
    },
    ...(hasLiquid && position
      ? [
          {
            action: /** @type {const} */ ("unstakeSozu"),
            id: "sozu",
            label: "With Sozu",
            lux: position.balance,
            stDusk: position.stDusk,
          },
        ]
      : []),
    {
      action: hasNative ? "claim" : undefined,
      id: "rewards",
      label: hasLiquid ? "Native rewards" : "Rewards",
      lux: stakeInfo.reward,
    },
    {
      id: "available",
      label: "Available to stake",
      lux: publicBalance,
      sub: "From your public balance",
    },
  ];
  // Unstake and Claim show once there is something natively staked.
  $: hasNative = staked > 0n || stakeInfo.reward > 0n;

  // Over what each rate was measured, said once under both ways on a phone
  // where it's the same, and on each where it isn't.
  $: nativePeriod = nativeRate ? periodOf(nativeDays) : "";
  $: sozuPeriod = sozuRate && fees ? periodOf(sozuDays) : "";
  $: periods = [...new Set([nativePeriod, sozuPeriod].filter(Boolean))];
  $: sharedPeriod = periods.length === 1 ? periods[0] : "";

  // A new stake earns from the block it becomes eligible at.
  $: eligibility = stakeInfo.amount?.eligibility ?? 0n;
  $: isMaturing = blockHeight !== undefined && eligibility > blockHeight;
</script>

<div class="staking">
  <section aria-labelledby="staking-title" class="staking__main">
    <h1 class="staking__title" id="staking-title" use:pageTitle>Staking</h1>

    <div class="staking__summary">
      <div class="staking__summary-row">
        <dl class="staking__figures">
          {#each figures as figure (figure.id)}
            <div class:staking__held={figure.action}>
              <dt class="ledger-label">{figure.label}</dt>
              <dd>
                <!-- The balance, what it's in, then what can be done with
                  it: in that order for a screen reader, however it shows. -->
                <span class="staking__line">
                  <span class="staking__amount"
                    ><span class="staking__figure"
                      ><BalanceValue {...amountOf(figure.lux)} /></span
                    > DUSK</span
                  >
                  {#if figure.sub}
                    <span class="staking__sub">{figure.sub}</span>
                  {:else if figure.stDusk !== undefined}
                    <span class="staking__sub"
                      ><BalanceValue {...amountOf(figure.stDusk)} /> stDUSK, rewards
                      included</span
                    >
                  {/if}
                  {#if figure.action === "unstake"}
                    <Button
                      className="staking__act"
                      disabled={!actions.canUnstake}
                      on:click={() => goto("/dashboard/stake?flow=unstake")}
                      size="small"
                      text={hasLiquid ? "Unstake native" : "Unstake"}
                      variant="secondary"
                    />
                  {:else if figure.action === "claim"}
                    <Button
                      className="staking__act"
                      disabled={!actions.canClaim}
                      on:click={() => goto("/dashboard/stake?flow=claim")}
                      size="small"
                      text="Claim rewards"
                      variant="secondary"
                    />
                  {:else if figure.action === "unstakeSozu"}
                    <AppAnchorButton
                      className="staking__act"
                      disabled={pending}
                      href="/dashboard/stake?flow=liquid&action=unstake"
                      on:click={notWhilePending}
                      size="small"
                      text="Unstake from Sozu"
                      variant="secondary"
                    />
                  {/if}
                </span>
              </dd>
            </div>
          {/each}
        </dl>

        {#if hasNative || hasLiquid}
          {#each actions.reasons as reason (reason)}
            <p class="staking__reason">{reason}</p>
          {/each}
        {/if}
      </div>

      {#if pending}
        <p class="staking__note">A staking transaction is pending.</p>
      {:else if stale || stakeReadFailed}
        <p class="staking__note">
          Stake couldn't be read. These amounts may be out of date. {lastReadText(
            stakeReadAt,
            locale,
          )}
        </p>
      {/if}

      {#if isSozuUnread}
        <div class="staking__note staking__note--retry">
          <p>
            {hasLiquid
              ? `Your Sozu stake couldn't be read. It may be out of date. ${lastReadText(sozu.readAt ?? sozu.kept?.at, locale)}`.trim()
              : "Your Sozu stake couldn't be read."}
          </p>
          <Button
            disabled={sozu.loading}
            on:click={onRetrySozu}
            size="small"
            text={sozu.loading ? "Trying again…" : "Try again"}
            variant="secondary"
          />
        </div>
      {/if}

      {#if isMaturing}
        <p class="staking__note">
          Rewards start at block {eligibility.toLocaleString(locale)}.
        </p>
      {/if}

      {#if locked > 0n}
        <p class="staking__note">
          Locked: <BalanceValue {...amountOf(locked)} /> DUSK. It's still yours, and
          unstaking returns it.
        </p>
      {/if}
    </div>

    <SectionHead className="staking__choose">Stake</SectionHead>

    <div class="staking__start">
      <AppAnchor
        aria-describedby="stake-native-facts staking-terms"
        aria-disabled={pending}
        aria-labelledby="stake-native-title"
        className="dusk-anchor-button dusk-anchor-button--variant--primary dusk-anchor-button--size--default compare__go{pending
          ? ' dusk-anchor-button--disabled'
          : ''}"
        href="/dashboard/stake?flow=native"
        on:click={notWhilePending}
        tabindex={pending ? "-1" : undefined}
      >
        <span class="choice__icon choice__extra"
          ><Icon path={mdiServerOutline} /></span
        >
        <span class="choice__body">
          <span class="choice__title" id="stake-native-title"
            >{hasStake ? "Add to native stake" : "Stake natively"}</span
          >
          <span class="choice__facts choice__extra" id="stake-native-facts">
            <span>Needs your own node</span>
            <span
              >{hasStake
                ? "Network fee only"
                : `From ${formatDusk(minimumStake, locale)} DUSK · network fee only`}</span
            >
            {#if nativeRate}
              <span
                >About {ratePercent(nativeRate, locale)} a year{sharedPeriod
                  ? ""
                  : ` ${nativePeriod}`}</span
              >
            {/if}
          </span>
        </span>
        <span class="choice__chevron choice__extra"
          ><Icon path={mdiChevronRight} /></span
        >
      </AppAnchor>
      {#if sozu.available}
        <AppAnchor
          aria-describedby="stake-sozu-facts{isSozuPaused || isSozuUnchecked
            ? ' stake-sozu-notice'
            : ''} staking-terms"
          aria-disabled={pending}
          aria-labelledby="stake-sozu-title"
          className="dusk-anchor-button dusk-anchor-button--variant--primary dusk-anchor-button--size--default compare__go{pending
            ? ' dusk-anchor-button--disabled'
            : ''}"
          href="/dashboard/stake?flow=liquid"
          on:click={notWhilePending}
          tabindex={pending ? "-1" : undefined}
        >
          <span class="choice__icon choice__extra"
            ><Icon path={mdiWaterOutline} /></span
          >
          <span class="choice__body">
            <span class="choice__title" id="stake-sozu-title"
              >{hasLiquid ? "Add to Sozu stake" : "Stake with Sozu"}</span
            >
            <span class="choice__facts choice__extra" id="stake-sozu-facts">
              <span>Third party · no node needed</span>
              <span
                >Any amount{fees
                  ? ` · ${feePercent(fees.deposit, locale)} deposit fee`
                  : ""}</span
              >
              {#if sozuRate && fees}
                <span
                  >About {ratePercent(sozuRate, locale)} a year{sharedPeriod
                    ? ""
                    : ` ${sozuPeriod}`}, after Sozu's {feePercent(
                    fees.reward,
                    locale,
                  )}</span
                >
              {/if}
            </span>
          </span>
          <span class="choice__chevron choice__extra"
            ><Icon path={mdiChevronRight} /></span
          >
        </AppAnchor>
      {/if}
    </div>
    {#if sozu.available && isSozuPaused}
      <p class="staking__reason" id="stake-sozu-notice">
        Sozu has paused deposits.
      </p>
    {:else if sozu.available && isSozuUnchecked}
      <p class="staking__reason" id="stake-sozu-notice">
        Sozu's deposits couldn't be checked.
      </p>
    {/if}

    <!-- Shown on phones only, and read with each way's facts wherever. -->
    <p class="staking__terms" id="staking-terms">
      {#if periods.length}
        {sharedPeriod
          ? `Rates ${sharedPeriod}, not promised.`
          : "Rates not promised."}
      {/if}
      {sozu.available
        ? "Penalties can lock or burn part of a native stake, and lower what stDUSK is worth."
        : "Penalties can lock or burn part of your stake."}
    </p>
    <button
      aria-controls="staking-compare"
      aria-expanded={isComparisonOpen}
      class="staking__compare"
      on:click={() => {
        isComparisonOpen = !isComparisonOpen;
      }}
      type="button"
    >
      <span>{sozu.available ? "Compare both" : "About native staking"}</span>
      <Icon path={mdiChevronDown} />
    </button>
    <table
      class="compare"
      class:compare--open={isComparisonOpen}
      id="staking-compare"
    >
      <caption class="sr-only">The ways to stake, side by side</caption>
      <colgroup>
        <col class="compare__labels" />
        <col />
        {#if sozu.available}
          <col />
        {/if}
      </colgroup>
      <thead>
        <tr>
          <td></td>
          <th scope="col">
            <span class="compare__way"
              ><span class="compare__icon"
                ><Icon path={mdiServerOutline} /></span
              >Native staking</span
            >
          </th>
          {#if sozu.available}
            <th scope="col">
              <span class="compare__way"
                ><span class="compare__icon"
                  ><Icon path={mdiWaterOutline} /></span
                >Liquid staking
                <span class="compare__tag">Sozu · third party</span></span
              >
            </th>
          {/if}
        </tr>
      </thead>
      <tbody>
        <tr>
          <th scope="row">Minimum</th>
          <td data-way="Native staking"
            >{formatDusk(minimumStake, locale)} DUSK</td
          >
          {#if sozu.available}
            <td data-way="Liquid staking (Sozu, third party)">Any amount</td>
          {/if}
        </tr>
        <tr>
          <th scope="row">Node</th>
          <td data-way="Native staking">
            Your own node<br />
            <a
              class="compare__link text-link"
              href={DOCUMENTATION_LINKS.RUN_A_PROVISIONER}
              rel="noopener noreferrer external"
              target="_blank">Run a node <Icon path={mdiOpenInNew} /></a
            >
          </td>
          {#if sozu.available}
            <td data-way="Liquid staking (Sozu, third party)">Not needed</td>
          {/if}
        </tr>
        <tr>
          <th scope="row">Rewards</th>
          <td data-way="Native staking">
            {#if nativeRate}
              <span class="compare__rate"
                >About {ratePercent(nativeRate, locale)} a year{nativeDays
                  ? ` over the last ${nativeDays} days`
                  : ", estimated across the network"}. Not promised.</span
              >
            {/if}
            Starts in about 6–12 hours
          </td>
          {#if sozu.available}
            <td data-way="Liquid staking (Sozu, third party)">
              {#if sozuRate && fees}
                <span class="compare__rate"
                  >About {ratePercent(sozuRate, locale)} a year{sozuDays
                    ? ` over the last ${sozuDays} days,`
                    : ""} after Sozu's {feePercent(fees.reward, locale)}. Not
                  promised.</span
                >
              {/if}
              {#if rate}
                You get stDUSK. Each is worth {formatDusk(rate, locale)} DUSK now.
                It usually rises with rewards, but can fall with a penalty.
              {:else}
                You get stDUSK, a token for your share of Sozu's pool. Its worth
                usually rises with rewards, but can fall with a penalty.
              {/if}
            </td>
          {/if}
        </tr>
        {#if sozu.available && fees}
          <tr>
            <th scope="row">Fees</th>
            <td data-way="Native staking">Network fee</td>
            <td data-way="Liquid staking (Sozu, third party)">
              {feePercent(fees.reward, locale)} of rewards · {feePercent(
                fees.deposit,
                locale,
              )} of deposits
            </td>
          </tr>
        {/if}
        <tr>
          <th scope="row">Unstake</th>
          <td data-way="Native staking">Any time, no waiting period</td>
          {#if sozu.available}
            <td data-way="Liquid staking (Sozu, third party)">
              Any time, no waiting, no Sozu fee
            </td>
          {/if}
        </tr>
        <tr>
          <th scope="row">Risk</th>
          <td data-way="Native staking">
            Node misses a turn: part locked, unstaking returns it. Breaks the
            rules: part can be burned (lost).
          </td>
          {#if sozu.available}
            <td data-way="Liquid staking (Sozu, third party)">
              <a
                class="compare__link text-link"
                href={SOZU_URL}
                rel="noopener noreferrer external"
                target="_blank">sozu.fi <Icon path={mdiOpenInNew} /></a
              >
            </td>
          {/if}
        </tr>
      </tbody>
    </table>
    {#if rewards}
      <div class="staking__years">
        <RewardsByYear
          bind:valued={rewardsValued}
          currency={rewardsCurrency}
          {locale}
          priced={rewardsPriced}
          {rewards}
        />
      </div>
    {/if}
  </section>

  <aside class="staking__side">
    {#if activity}
      <ActivityPanel
        emptyText="No staking yet."
        {locale}
        only="staking"
        onRetry={onRetryHistory}
        state={activity}
        title="Staking activity"
        whole={wholeActivity}
      />
    {:else}
      <SectionHead>Staking activity</SectionHead>
      <p class="staking__reason">
        Activity isn't available here yet. The explorer has your transactions.
      </p>
    {/if}
  </aside>
</div>

<style lang="postcss">
  .staking {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 25rem;
    flex: 1;
    width: 100%;
  }

  .staking__main {
    min-width: 0;
    padding: 2.25rem 3rem 3rem;
  }

  .staking__title {
    font-size: 1.75rem;
    font-weight: 500;
    letter-spacing: -0.01em;
    line-height: 1.15;
  }

  .staking__summary {
    container-type: inline-size;
    display: flex;
    flex-direction: column;
    gap: 1rem;
    margin-top: 1.5rem;
    padding: 1.5rem 1.75rem;
    border: 1px solid var(--calm-line2);
    border-radius: 1rem;
  }

  .staking__summary-row {
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
  }

  .staking__figures {
    display: flex;
    flex-wrap: wrap;
    gap: 1.25rem 2.5rem;
    margin: 0;

    & dt {
      color: var(--calm-muted);
    }

    & dd {
      display: flex;
      flex-direction: column;
      gap: 0.125rem;
      margin: 0.25rem 0 0;
    }
  }

  .staking__amount {
    color: var(--calm-muted);
    font-size: 0.9375rem;
    white-space: nowrap;
  }

  .staking__figure {
    color: var(--calm-text);
    font-size: 1.75rem;
    font-variant-numeric: tabular-nums;
  }

  .staking__sub {
    color: var(--calm-muted);
    font-size: 0.8125rem;
  }

  /* The amount and its action: one line on a phone, the figure's first and last from a tablet. */
  .staking__line {
    display: contents;
  }

  .staking__figures :global(.staking__act) {
    order: 1;
    align-self: flex-start;
    margin-top: 0.625rem;
  }

  /* From a tablet: even columns, their actions on one line. */
  @media (min-width: 48rem) {
    .staking__figures {
      gap: 1.25rem 1rem;

      /* Even, and never narrower than its amount: a long one wraps the row. */
      & > div {
        display: flex;
        flex: 1 0 calc(50% - 0.5rem);
        flex-direction: column;
      }

      & dd {
        flex: 1;
      }

      /* Pushed to its column's foot, clear of what's above it. */
      & :global(.staking__act) {
        margin-top: auto;
      }

      & .staking__amount {
        margin-bottom: 0.25rem;
      }

      & .staking__sub {
        margin-bottom: 0.75rem;
      }
    }

    @container (min-width: 44rem) {
      .staking__figures > div {
        flex-basis: 10rem;
      }

      .staking__figures .staking__figure {
        font-size: 1.5rem;
      }
    }
  }

  .staking__reason {
    color: var(--calm-text);
    font-size: 0.84375rem;
  }

  .staking__note {
    font-size: 0.875rem;

    &--retry {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 0.5rem;
    }
  }

  .staking__years {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    margin-top: 2.5rem;
  }

  .staking__main :global(.staking__choose) {
    margin: 2rem 0 0.75rem;
  }

  .compare {
    width: 100%;
    border: 1px solid var(--calm-line2);
    border-radius: 1rem;
    border-collapse: separate;
    border-spacing: 0;
    font-size: 0.9375rem;

    & th,
    & td {
      padding: 1rem 1.25rem;
      border-top: 1px solid var(--calm-line);
      text-align: left;
      vertical-align: top;
    }

    & thead th,
    & thead td {
      border-top: 0 none;
    }

    & tbody th {
      color: var(--calm-muted);
      font-weight: 400;
    }

    & thead th {
      font-size: 1.0625rem;
      font-weight: 500;
    }
  }

  .compare {
    table-layout: fixed;
  }

  .compare__labels {
    width: 10rem;
  }

  .compare__way {
    display: inline-flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.625rem;
  }

  .compare__icon {
    display: grid;
    place-items: center;
    width: 2.25rem;
    height: 2.25rem;
    border-radius: 50%;
    background: var(--calm-s2);

    & :global(.dusk-icon) {
      width: 1.125rem;
      height: 1.125rem;
    }
  }

  .compare__tag {
    padding: 0.125rem 0.625rem;
    border-radius: 999px;
    background: var(--calm-s2);
    font-size: 0.8125rem;
    font-weight: 400;
  }

  .compare__rate {
    display: block;
    margin-bottom: 0.25rem;
    color: var(--calm-text);
  }

  .compare__link {
    text-decoration: underline;
    text-underline-offset: 2px;
    white-space: nowrap;

    & :global(.dusk-icon) {
      display: inline;
      width: 0.875rem;
      height: 0.875rem;
      vertical-align: -0.125rem;
    }
  }

  .staking__start {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr));
    gap: 0.75rem;
    margin-bottom: 1rem;
  }

  .staking__start :global(.compare__go) {
    width: 100%;
    min-height: 44px;
  }

  /* Managing a stake is quieter than the ways to start one. */
  .staking__figures :global(.staking__act) {
    min-height: 44px;
    border-color: var(--calm-line2);
    background-color: transparent;
  }

  .staking__figures :global(.staking__act:disabled),
  .staking__figures :global(.staking__act.dusk-anchor-button--disabled) {
    opacity: 0.55;
  }

  .staking__figures :global(button.staking__act:enabled:hover),
  .staking__figures :global(a.staking__act:hover) {
    background-color: var(--calm-s2);
  }

  /* Only a phone's choices say more than their name. */
  .choice__extra,
  .staking__terms,
  .staking__compare {
    display: none;
  }

  .staking__start :global(.compare__go > .choice__body) {
    white-space: nowrap;
  }

  /*
   * Each way's button over its column of the comparison: past the labels'
   * column and the table's edge, and in as far as the column's text.
   */
  @media (min-width: 48rem) {
    .staking__start {
      grid-template-columns: 10rem;
      grid-auto-columns: minmax(0, 1fr);
      grid-auto-flow: column;
      gap: 0;
      padding-inline: 1px;

      /* The labels' column, empty here. */
      &::before {
        content: "";
      }

      & :global(.compare__go) {
        width: auto;
        margin-inline: 1.25rem;
      }
    }
  }

  .staking__side {
    position: sticky;
    top: var(--header-height);
    align-self: start;
    max-height: calc(100vh - var(--header-height));
    min-height: calc(100vh - var(--header-height));
    overflow-y: auto;
    padding: 1.5rem 1.5rem 2rem;
    border-left: 1px solid var(--calm-line);
    background: var(--calm-panel);
  }

  @media (max-width: 79.99rem) {
    .staking {
      grid-template-columns: minmax(0, 1fr) 21rem;
    }

    .staking__main {
      padding: 2rem 2rem 3rem;
    }
  }

  /* Narrow screens: the staking activity under the rest. */
  @media (max-width: 63.99rem) {
    .staking {
      grid-template-columns: minmax(0, 1fr);
    }

    .staking__main {
      padding: 1.75rem 1.5rem 1rem;
    }

    .staking__side {
      position: static;
      min-height: 0;
      max-height: none;
      border-top: 1px solid var(--calm-line);
      border-left: 0 none;
    }
  }

  /*
   * Phones: each way is a row that says what tells it apart, and the
   * comparison waits behind its button, each of its rows saying which way it
   * is about.
   */
  @media (max-width: 47.99rem) {
    /* The figures in pairs, so both ways to stake show without scrolling. */
    .staking__figures {
      gap: 1rem 0.75rem;

      & > div {
        flex: 1 0 calc(50% - 0.375rem);
        max-width: 100%;
      }
    }

    .staking__amount {
      white-space: normal;
    }

    /* A balance that can be acted on takes a row, its action at the end. */
    .staking__figures > .staking__held {
      flex-basis: 100%;
    }

    /* Both on a line, or the action under an amount too long for that. */
    @media (min-width: 22.5rem) {
      .staking__held .staking__line {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: 1rem 0.5rem;
      }

      /*
       * Under both, so it keeps to one line: a row of its own after the
       * action's, as near the amount as the column's gap (0.125rem) where
       * the line's own (1rem) would part them.
       */
      .staking__held .staking__sub {
        flex-basis: 100%;
        order: 2;
        margin-top: calc(0.125rem - 1rem);
        padding-top: 0.375rem;
      }

      .staking__held :global(.staking__act) {
        /* One width, so their edges line up on both sides. */
        width: 8.5rem;
        margin-block: -0.5rem;
        margin-left: auto;
        padding-inline: 0.5rem;
        /* Centred on the amount's line, which it doesn't make taller. */
        align-self: center;
      }
    }

    /* Too narrow for both on a line: the action goes under its balance. */
    @media (max-width: 22.49rem) {
      .staking__held :global(.staking__act) {
        align-self: flex-start;
        width: 8.5rem;
        margin-top: 0.5rem;
        padding-inline: 0.5rem;
      }
    }

    .staking__figures .staking__figure {
      font-size: 1.25rem;
    }

    .staking__start {
      grid-template-columns: minmax(0, 1fr);
      /* As tall as each other: neither way looks the bigger one. */
      grid-auto-rows: 1fr;
      gap: 0.5rem;
      margin-bottom: 0.5rem;

      & :global(.compare__go),
      & :global(.compare__go:hover) {
        justify-content: flex-start;
        gap: 0.75rem;
        padding: 0.875rem 1rem;
        border-color: transparent;
        border-radius: 1rem;
        background-color: var(--calm-s2);
        color: var(--calm-text);
        opacity: 1;
        text-align: left;
      }

      & :global(.compare__go.dusk-anchor-button--disabled) {
        border-color: var(--calm-line2);
        background-color: transparent;
        color: var(--calm-subtle);
      }
    }

    .staking__start :global(.compare__go > .choice__icon) {
      display: grid;
      flex: none;
      place-items: center;
      width: 2.5rem;
      height: 2.5rem;
      border-radius: 50%;
      background: var(--calm-panel);
    }

    .staking__start :global(.compare__go > .choice__body) {
      display: flex;
      flex: 1;
      flex-direction: column;
      gap: 0.25rem;
      min-width: 0;
      white-space: normal;
    }

    .staking__start :global(.compare__go > .choice__chevron) {
      display: flex;
      flex: none;
      color: var(--calm-muted);
    }

    .choice__title {
      font-size: 1.0625rem;
    }

    .choice__facts {
      display: flex;
      flex-direction: column;
      gap: 0.125rem;
      color: var(--calm-muted);
      font-size: 0.8125rem;
      font-weight: 400;
      line-height: 1.35;
    }

    .staking__terms {
      display: block;
      color: var(--calm-muted);
      font-size: 0.8125rem;
    }

    .staking__compare {
      display: flex;
      align-items: center;
      justify-content: space-between;
      width: 100%;
      min-height: 44px;
      margin-top: 0.75rem;
      padding: 0.75rem 1rem;
      border: 1px solid var(--calm-line2);
      border-radius: 1rem;
      background: none;
      color: var(--calm-text);
      font: inherit;
      cursor: pointer;

      &[aria-expanded="true"] :global(.dusk-icon) {
        transform: rotate(180deg);
      }
    }

    .compare:not(.compare--open) {
      display: none;
    }

    .compare--open {
      margin-top: 0.5rem;
    }

    .staking__main {
      padding: 1rem 1rem 1rem;
    }

    .staking__summary {
      padding: 1.25rem;
    }

    .staking__figure {
      font-size: 1.5rem;
    }

    .compare,
    .compare tbody,
    .compare tr,
    .compare th,
    .compare td {
      display: block;
      width: auto;
    }

    .compare thead {
      display: none;
    }

    .compare tbody th {
      width: auto;
      padding-bottom: 0.25rem;
      color: var(--calm-text);
      font-weight: 500;
    }

    .compare tbody td {
      padding-top: 0.375rem;
      padding-bottom: 0.375rem;
      border-top: 0 none;
    }

    .compare tbody td::before {
      content: attr(data-way);
      display: block;
      color: var(--calm-muted);
      font-size: 0.8125rem;
    }

    .compare tbody tr {
      padding-bottom: 0.625rem;
    }

    /* With the header hidden, the table's own edge is the first row's. */
    .compare tbody tr:first-child th {
      border-top: 0 none;
    }
  }
</style>
