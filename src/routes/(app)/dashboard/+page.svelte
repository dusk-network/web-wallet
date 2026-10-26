<script>
  import {
    mdiEyeOffOutline,
    mdiLayersOutline,
    mdiSendOutline,
    mdiSwapHorizontal,
    mdiTrayArrowDown,
  } from "@mdi/js";
  import { activityState, isHistoryEnabled } from "$lib/activity";
  import { isStakingRow } from "$lib/activity/present";
  import { contractDescriptors } from "$lib/contracts";
  import {
    ActivityPanel,
    ExplainerCards,
    HomeActions,
    HomeBalance,
  } from "$lib/containers/Home";
  import { addBasePath } from "$lib/navigation";
  import { isSozuCall, sozuContractsFor, sozuStore } from "$lib/sozu";
  import { networkStore, settingsStore, walletStore } from "$lib/stores";

  /** @type {import("./$types").PageData} */
  export let data;

  /** @type {number | undefined} */
  let fiatPrice;

  const { currency, language } = $settingsStore;

  data.currentPrice.then((prices) => {
    fiatPrice = prices[currency.toLowerCase()];
  });

  /** @param {string} id */
  const isEnabled = (id) =>
    contractDescriptors.some(
      (contract) => contract.id === id && contract.enabled === true
    );

  const actions = [
    {
      href: "/dashboard/send",
      icon: mdiSendOutline,
      id: "send",
      label: "Send",
      primary: true,
    },
    {
      href: "/dashboard/receive",
      icon: mdiTrayArrowDown,
      id: "receive",
      label: "Receive",
    },
    {
      href: "/dashboard/allocate",
      icon: mdiEyeOffOutline,
      id: "allocate",
      label: "Shield",
    },
    {
      href: "/dashboard/stake",
      icon: mdiLayersOutline,
      id: "stake",
      label: "Stake",
    },
    {
      href: "/dashboard/bridge",
      icon: mdiSwapHorizontal,
      id: "bridge",
      label: "Bridge",
    },
  ].filter(({ id }) => isEnabled(id));

  $: ({ balance, currentProfile, minimumStake, stakeInfo } = $walletStore);
  // Test DUSK has no value: no money value off mainnet.
  $: ({ networkName } = $networkStore);
  $: staked = stakeInfo.amount
    ? stakeInfo.amount.value + stakeInfo.amount.locked
    : null;
  $: ({ rows } = $activityState);
  $: hasPastStaking = rows.some(isStakingRow);

  // What is staked with Sozu, read only for an account that used it.
  $: if (rows.some(isSozuCall) && networkName && currentProfile) {
    void sozuStore.load();
  }
  $: ({ account: sozuAccount, status: sozuStatus } = $sozuStore);
  $: liquid =
    sozuStatus && sozuAccount === String(currentProfile?.account ?? "")
      ? sozuStatus.position.balance
      : 0n;
</script>

<div class="home">
  <div class="home__main">
    <HomeBalance
      fiatCurrency={currency}
      fiatPrice={networkName === "mainnet" ? fiatPrice : undefined}
      locale={language}
      shielded={balance.shielded.value}
      unshielded={balance.unshielded.value}
    />

    {#if actions.length}
      <HomeActions {actions} />
    {:else}
      <p class="home__note">Nothing can be sent from this wallet right now.</p>
    {/if}

    {#if isEnabled("migrate")}
      <p class="home__note">
        Have DUSK on Ethereum or BNB Smart Chain?
        <a href={addBasePath("/dashboard/migrate")}>Migrate it to Dusk</a>
      </p>
    {/if}
  </div>

  <div class="home__cards">
    <ExplainerCards
      {hasPastStaking}
      {liquid}
      locale={language}
      {minimumStake}
      reward={stakeInfo.reward}
      shielded={balance.shielded.value}
      sozuAvailable={sozuContractsFor(networkName) !== null}
      stakeEnabled={isEnabled("stake")}
      {staked}
      unshielded={balance.unshielded.value}
    />
  </div>

  <aside class="home__side">
    {#if isHistoryEnabled()}
      <ActivityPanel
        locale={language}
        onRetry={() => {
          walletStore
            .startHistory()
            ?.refresh()
            .catch(() => {});
        }}
        state={$activityState}
      />
    {:else}
      <h2 class="home__side-title">Activity</h2>
      <p class="home__note home__note--side">
        Transaction history isn't available here yet. The Dusk explorer has your
        transactions.
      </p>
    {/if}
  </aside>
</div>

<style lang="postcss">
  .home {
    display: grid;
    grid-template-areas:
      "main side"
      "cards side";
    grid-template-columns: minmax(0, 1fr) 25rem;
    grid-template-rows: auto 1fr;
    flex: 1;
    width: 100%;
  }

  .home__main {
    grid-area: main;
    display: flex;
    flex-direction: column;
    gap: 1.75rem;
    min-width: 0;
    padding: 2.25rem 3rem 0;
  }

  .home__cards {
    grid-area: cards;
    min-width: 0;
    padding: 2rem 3rem 3rem;
  }

  .home__side {
    grid-area: side;
    position: sticky;
    top: var(--header-height);
    align-self: start;
    max-height: calc(100vh - var(--header-height));
    overflow-y: auto;
    padding: 1.5rem 1.5rem 2rem;
    border-left: 1px solid var(--calm-line);
    background: var(--calm-panel);
    min-height: calc(100vh - var(--header-height));
  }

  .home__side-title {
    font-size: 1rem;
    font-weight: 500;
  }

  .home__note--side {
    margin-top: 0.75rem;
  }

  .home__note {
    margin-top: -0.75rem;
    color: var(--calm-muted);
    font-size: 0.875rem;

    & a {
      color: var(--calm-text);
      text-underline-offset: 3px;
    }
  }

  /* One column: the activity right under the actions. */
  @media (max-width: 63.99rem) {
    .home {
      grid-template-areas:
        "main"
        "side"
        "cards";
      grid-template-columns: minmax(0, 1fr);
      grid-template-rows: auto;
    }

    .home__main {
      padding: 1.75rem 1.5rem 0.5rem;
    }

    .home__cards {
      padding: 0.5rem 1.5rem 2rem;
    }

    .home__side {
      position: static;
      max-height: none;
      min-height: 0;
      overflow: visible;
      border-left: 0 none;
      background: none;
      padding: 0.5rem 1.5rem 2rem;
    }
  }

  @media (max-width: 47.99rem) {
    .home__main {
      gap: 1.5rem;
      padding: 1rem 1rem 0.5rem;
    }

    .home__side {
      padding: 0.5rem 1rem 1rem;
    }

    .home__cards {
      padding: 0.5rem 1rem 1.5rem;
    }
  }
</style>
