<script>
  import { mdiOpenInNew, mdiServerOutline, mdiWaterOutline } from "@mdi/js";

  import { DOCUMENTATION_LINKS } from "$lib/constants";
  import { formatDusk, formatDuskExact } from "$lib/dusk/currency";
  import { Button, Icon } from "$lib/dusk/components";
  import { AppAnchorButton, BalanceValue, SectionHead } from "$lib/components";
  import { goto, pageTitle } from "$lib/navigation";
  import { SOZU_URL } from "$lib/sozu/config";
  import { duskPerStDusk, feePercent } from "$lib/sozu/amounts";

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

  /** Whether the history holds staking. */
  export let hasPastStaking = false;

  /** What was read from Sozu, and whether this network has it. */
  /** @type {import("$lib/sozu/sozuStore").SozuState} */
  export let sozu;

  /** @type {string} */
  export let locale;

  /** The history, for the staking in it; null without one. */
  /** @type {import("$lib/activity/activitySession").ActivityState | null} */
  export let activity = null;

  /** @type {() => void} */
  export let onRetryHistory = () => {};

  /** The chain's height, once known. */
  /** @type {bigint | undefined} */
  export let blockHeight = undefined;

  /** @param {bigint} lux */
  const amountOf = (lux) => ({
    exact: formatDuskExact(lux, locale),
    value: formatDusk(lux, locale),
  });

  $: staked = stakeInfo.amount?.total ?? 0n;
  $: locked = stakeInfo.amount?.locked ?? 0n;
  $: hasStake = stakeInfo.amount !== null;
  $: actions = stakeActions({
    hasLiquid,
    hasPastStaking,
    maxFee,
    publicBalance,
    reward: stakeInfo.reward,
    staked,
  });
  $: position = sozu.status?.position ?? null;
  $: hasLiquid =
    position !== null && (position.balance > 0n || position.stDusk > 0n);
  $: rate = duskPerStDusk(sozu.status?.pool ?? null);
  // Sozu's fees, as its substrate gives them, where they could be read.
  $: fees = sozu.status?.fees ?? null;
  // No deposits while Sozu is under maintenance, or while that can't be
  // checked.
  $: sozuMaintenance = sozu.status?.flags?.maintenance;
  $: isSozuPaused = sozuMaintenance === true;
  $: isSozuUnchecked =
    Boolean(sozu.status) &&
    sozuMaintenance !== true &&
    sozuMaintenance !== false;

  /** @type {{ label: string, lux: bigint, stDusk?: bigint, sub?: string }[]} */
  // What is staked comes first, natively and with Sozu. With nothing
  // natively staked, the native stake says there's nothing to unstake or
  // claim, away from Unstake from Sozu; its rewards are the native stake's,
  // as Sozu's are in what is staked there.
  $: figures = [
    {
      label: hasLiquid ? "Staked natively" : "Staked",
      lux: staked,
      sub: hasNative ? undefined : "Nothing to unstake or claim",
    },
    ...(hasLiquid && position
      ? [
          {
            label: "With Sozu",
            lux: position.balance,
            stDusk: position.stDusk,
          },
        ]
      : []),
    { label: hasLiquid ? "Native rewards" : "Rewards", lux: stakeInfo.reward },
    {
      label: "Available to stake",
      lux: publicBalance,
      sub: "From your public balance",
    },
  ];
  // Unstake and Claim show once there is something natively staked.
  $: hasNative = staked > 0n || stakeInfo.reward > 0n;

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
          {#each figures as figure (figure.label)}
            <div>
              <dt class="ledger-label">{figure.label}</dt>
              <dd>
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
              </dd>
            </div>
          {/each}
        </dl>

        {#if hasNative || hasLiquid}
          <div class="staking__actions">
            <div class="staking__buttons">
              {#if hasNative}
                <Button
                  disabled={!actions.canUnstake}
                  on:click={() => goto("/dashboard/stake?flow=unstake")}
                  text="Unstake"
                  variant="secondary"
                />
                <Button
                  disabled={!actions.canClaim}
                  on:click={() => goto("/dashboard/stake?flow=claim")}
                  text="Claim rewards"
                  variant="secondary"
                />
              {/if}
              {#if hasLiquid}
                <AppAnchorButton
                  href="/dashboard/stake?flow=liquid&action=unstake"
                  text="Unstake from Sozu"
                  variant="secondary"
                />
              {/if}
            </div>
            {#each actions.reasons as reason (reason)}
              <p class="staking__reason">{reason}</p>
            {/each}
          </div>
        {/if}
      </div>

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
      <AppAnchorButton
        className="compare__go"
        href="/dashboard/stake?flow=native"
        text={hasStake ? "Stake more" : "Stake natively"}
        variant="secondary"
      />
      {#if sozu.available}
        <AppAnchorButton
          className="compare__go"
          href="/dashboard/stake?flow=liquid"
          text="Stake with Sozu"
          variant="secondary"
        />
      {/if}
    </div>
    {#if sozu.available && isSozuPaused}
      <p class="staking__reason">Sozu has paused deposits.</p>
    {:else if sozu.available && isSozuUnchecked}
      <p class="staking__reason">Sozu's deposits couldn't be checked.</p>
    {/if}

    <table class="compare">
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
            Needs your own Dusk node: a computer that runs Dusk's node software
            and stays online.
            <a
              class="compare__link text-link"
              href={DOCUMENTATION_LINKS.STAKING_BASICS}
              rel="noopener noreferrer"
              target="_blank">What's a node? <Icon path={mdiOpenInNew} /></a
            >
          </td>
          {#if sozu.available}
            <td data-way="Liquid staking (Sozu, third party)">Not needed</td>
          {/if}
        </tr>
        <tr>
          <th scope="row">Rewards</th>
          <td data-way="Native staking">Start in about 6 to 12 hours</td>
          {#if sozu.available}
            <td data-way="Liquid staking (Sozu, third party)">
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
            <td data-way="Native staking">Network fee only</td>
            <td data-way="Liquid staking (Sozu, third party)">
              Sozu keeps {feePercent(fees.reward, locale)} of rewards · {feePercent(
                fees.deposit,
                locale
              )} on deposits · no unstake fee
            </td>
          </tr>
        {/if}
        <tr>
          <th scope="row">Unstake</th>
          <td data-way="Native staking">Any time, with no waiting period</td>
          {#if sozu.available}
            <td data-way="Liquid staking (Sozu, third party)">
              The DUSK comes back in the same transaction. No fee, no waiting.
            </td>
          {/if}
        </tr>
        <tr>
          <th scope="row">If it goes wrong</th>
          <td data-way="Native staking">
            If your node misses its turn, part of your stake gets locked. It's
            still yours, and unstaking returns it. If the node breaks the rules,
            part of the stake can be burned (lost).
          </td>
          {#if sozu.available}
            <td data-way="Liquid staking (Sozu, third party)">
              Sozu's contract and rules apply:
              <a
                class="compare__link text-link"
                href={SOZU_URL}
                rel="noopener noreferrer"
                target="_blank">sozu.fi <Icon path={mdiOpenInNew} /></a
              >
            </td>
          {/if}
        </tr>
      </tbody>
    </table>
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
      />
    {:else}
      <SectionHead>Staking activity</SectionHead>
      <p class="staking__reason">
        Transaction history isn't available here yet. The Dusk explorer has your
        transactions.
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

  .staking__actions {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.625rem;
  }

  .staking__buttons {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }

  /* Room for both: the buttons and why they're off beside the figures. */
  @container (min-width: 52rem) {
    .staking__summary-row {
      flex-direction: row;
      align-items: flex-start;
      justify-content: space-between;
      gap: 2rem;
    }

    .staking__actions {
      align-items: flex-end;
      max-width: 26rem;
      text-align: right;
    }

    .staking__buttons {
      justify-content: flex-end;
    }
  }

  .staking__reason {
    color: var(--calm-text);
    font-size: 0.84375rem;
  }

  .staking__note {
    font-size: 0.875rem;
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

  /* Phones: each row of the comparison says which way it is about. */
  @media (max-width: 47.99rem) {
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
  }
</style>
