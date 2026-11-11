<script>
  import {
    mdiEyeOffOutline,
    mdiLayersOutline,
    mdiSendOutline,
    mdiSwapHorizontal,
    mdiTrayArrowDown,
  } from "@mdi/js";
  import { mdiCheck } from "@mdi/js";
  import { activityState, isHistoryEnabled } from "$lib/activity";
  import { contractDescriptors } from "$lib/contracts";
  import { Banner, SectionHead } from "$lib/components";
  import { Button } from "$lib/dusk/components";
  import { toast } from "$lib/dusk/components/Toast/store";
  import {
    ActivityPanel,
    ExplainerCards,
    HomeActions,
    HomeBalance,
  } from "$lib/containers/Home";
  import { cardRoutes, migrationRoutes } from "$lib/bridge/cardRoutes";
  import { addBasePath } from "$lib/navigation";
  import { isSozuFunction, sozuContractsFor, sozuStore } from "$lib/sozu";
  import { networkStore, settingsStore, walletStore } from "$lib/stores";
  import networkReach from "$lib/stores/networkReach";
  import { waitingSends } from "$lib/transactions";

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

  $: ({ balance, currentProfile, minimumStake, stakeInfo, stakeReadFailed } =
    $walletStore);
  // Test DUSK has no value: no money value off mainnet.
  $: ({ net, networkName } = $networkStore);
  // Offered only where a migration runs: the Bridge opens on BNB Smart
  // Chain's, where there is one.
  $: [migration] = migrationRoutes(cardRoutes(net));
  $: staked = stakeInfo.amount
    ? stakeInfo.amount.value + stakeInfo.amount.locked
    : null;
  $: ({ rows } = $activityState);
  $: hasPastStaking = rows.some((row) => row.category === "staking");

  // What is staked with Sozu, read only for an account that called a pool
  // of its: read, a pool its hub named is known from then on. Where the
  // history couldn't be read, whether it did isn't known: it's read then too.
  $: ({ error: historyError } = $activityState);
  $: if (
    (rows.some(isSozuFunction) || (historyError && !rows.length)) &&
    networkName &&
    currentProfile
  ) {
    void sozuStore.load();
  }
  $: ({
    account: sozuAccount,
    error: sozuError,
    kept: sozuKept,
    loading: sozuLoading,
    status: sozuStatus,
  } = $sozuStore);
  $: isSozuShown = sozuAccount === String(currentProfile?.account ?? "");
  // As read now, or else as read last here: what couldn't be read isn't
  // nothing.
  $: liquid = isSozuShown
    ? (sozuStatus?.position.balance ?? sozuKept?.balance ?? 0n)
    : 0n;
  $: stakeUnread = stakeReadFailed || (isSozuShown && sozuError !== null);
  $: stakeReading = isSozuShown && sozuLoading && !sozuStatus && !sozuKept;

  /** Reads what's staked again, with Sozu too where it couldn't be read. */
  const readStakeAgain = () =>
    Promise.all([
      isSozuShown && sozuError ? sozuStore.load({ force: true }) : null,
      walletStore.refreshBalance(),
    ]);

  /**
   * Calls off a send that hasn't gone out, and says so: one that went out
   * meanwhile is no longer listed, as it's on its way.
   *
   * @param {import("$lib/transactions/waitingSends").WaitingSend} send
   */
  function cancelSend({ cancel, what }) {
    if (cancel(undefined)) {
      toast("success", `Not sent: ${what}.`, mdiCheck);
    }
  }
</script>

<div class="home">
  <div class="home__main">
    <HomeBalance
      fiatCurrency={currency}
      fiatPrice={networkName === "mainnet" ? fiatPrice : undefined}
      locale={language}
      shielded={balance.shielded.value}
      staked={(staked ?? 0n) + liquid}
      unshielded={balance.unshielded.value}
    />

    {#if actions.length}
      <HomeActions {actions} />
    {:else}
      <p class="home__note">Nothing can be sent from this wallet right now.</p>
    {/if}

    <!-- Sends that haven't gone out, as the network doesn't answer: called
      off from here, or they go out once it answers. -->
    {#each $waitingSends as send (send.id)}
      <Banner
        className="home__waiting"
        role="status"
        title={`Not sent yet: ${send.what}.`}
        variant="info"
      >
        <p>
          {$networkReach === "answering"
            ? "It's being sent."
            : "It goes out once the network answers."}
        </p>
        <Button
          className="home__waiting-cancel"
          on:click={() => cancelSend(send)}
          size="small"
          text="Cancel"
          variant="secondary"
        />
      </Banner>
    {/each}

    {#if isEnabled("bridge") && migration}
      <p class="home__note">
        Have DUSK on Ethereum or BNB Smart Chain?
        <a
          class="text-link tap-link"
          href={addBasePath(`/dashboard/bridge?route=${migration.id}`)}
          >Migrate it to Dusk</a
        >
      </p>
    {/if}
  </div>

  <div class="home__cards">
    <ExplainerCards
      {hasPastStaking}
      {liquid}
      locale={language}
      {minimumStake}
      onRetry={readStakeAgain}
      reward={stakeInfo.reward}
      shielded={balance.shielded.value}
      sozuAvailable={sozuContractsFor(net) !== null}
      stakeEnabled={isEnabled("stake")}
      {stakeReading}
      {stakeUnread}
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
      <SectionHead>Activity</SectionHead>
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

  .home__note--side {
    margin-top: 0.75rem;
  }

  .home__main :global(.home__waiting-cancel) {
    margin-top: 0.5rem;
  }

  .home__note {
    margin-top: -0.75rem;
    color: var(--calm-muted);
    font-size: 0.875rem;

    & a {
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
