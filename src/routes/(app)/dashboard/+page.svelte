<script>
  import {
    mdiCheck,
    mdiEyeOffOutline,
    mdiLayersOutline,
    mdiSendOutline,
    mdiSwapHorizontal,
    mdiTrayArrowDown,
  } from "@mdi/js";
  import {
    activityState,
    isHistoryEnabled,
    wholeActivity,
  } from "$lib/activity";
  import { resolve } from "$app/paths";
  import { timeLabel } from "$lib/activity/present";
  import { contractDescriptors } from "$lib/contracts";
  import { Banner, MemoText, SectionHead, UnsentSends } from "$lib/components";
  import { Button } from "$lib/dusk/components";
  import { toast } from "$lib/dusk/components/Toast/store";
  import {
    ActivityPanel,
    ExplainerCards,
    HomeActions,
    HomeBalance,
  } from "$lib/containers/Home";
  import { cardRoutes, migrationRoutes } from "$lib/bridge/cardRoutes";
  import { sozuContractsFor, sozuStore } from "$lib/sozu";
  import { networkStore, settingsStore, walletStore } from "$lib/stores";
  import networkReach from "$lib/stores/networkReach";
  import { waitingSends, waitingText } from "$lib/transactions";
  import reviewUnsent from "$lib/transactions/reviewUnsent";
  import {
    meanwhileKey,
    sayMeanwhile,
    sentMeanwhileChecking,
    sentMeanwhileTold,
  } from "$lib/transactions/sentMeanwhile";
  import accountNamer from "$lib/wallets/accountNamer";

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
      (contract) => contract.id === id && contract.enabled === true,
    );

  const actions =
    /** @type {import("svelte").ComponentProps<typeof HomeActions>["actions"]} */ ([
      {
        href: "/dashboard/send/",
        icon: mdiSendOutline,
        id: "send",
        label: "Send",
        primary: true,
      },
      {
        href: "/dashboard/receive/",
        icon: mdiTrayArrowDown,
        id: "receive",
        label: "Receive",
      },
      {
        href: "/dashboard/allocate/",
        icon: mdiEyeOffOutline,
        id: "allocate",
        label: "Shield",
      },
      {
        href: "/dashboard/stake/",
        icon: mdiLayersOutline,
        id: "stake",
        label: "Stake",
      },
      {
        href: "/dashboard/bridge/",
        icon: mdiSwapHorizontal,
        id: "bridge",
        label: "Bridge",
      },
    ]).filter(({ id }) => isEnabled(id));

  $: ({
    balance,
    balanceReadAt,
    balanceReadFailed,
    currentProfile,
    minimumStake,
    stakeInfo,
    stakeReadAt,
    stakeReadFailed,
  } = $walletStore);
  // Test DUSK has no value: no money value off mainnet.
  $: ({ net, networkName } = $networkStore);
  // Offered only where a migration runs: the Bridge opens on BNB Smart
  // Chain's, where there is one.
  $: [migration] = migrationRoutes(cardRoutes(net));
  $: staked = stakeInfo.amount
    ? stakeInfo.amount.value + stakeInfo.amount.locked
    : null;
  // From all of the history, not the page History has shown so far.
  $: hasPastStaking = $wholeActivity.rows.some(
    (row) => row.category === "staking",
  );

  // What is staked with Sozu, read for the profile shown as the wallet
  // opens and as another is chosen, where the network has Sozu: the history
  // shows its latest rows only, and a stake made long before is there all
  // the same.
  $: if (sozuContractsFor(net) && currentProfile) {
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
  // When what's staked was last read: of what couldn't be read again,
  // natively or with Sozu, the one read longest ago.
  $: stakeLastRead = Math.min(
    ...[
      stakeReadFailed ? stakeReadAt : null,
      isSozuShown && sozuError !== null
        ? ($sozuStore.readAt ?? sozuKept?.at ?? null)
        : null,
    ].filter((time) => time !== null),
    Infinity,
  );
  $: stakeReading = isSozuShown && sozuLoading && !sozuStatus && !sozuKept;

  /** Reads what's staked again, with Sozu too where it couldn't be read. */
  const readStakeAgain = () =>
    Promise.all([
      isSozuShown && sozuError ? sozuStore.load({ force: true }) : null,
      walletStore.refreshBalance(),
    ]);

  /**
   * What a waiting send sends, its amount as balances are shown now, not as
   * they were when it was sent.
   *
   * @param {import("$lib/transactions/waitingSends").WaitingSend} send
   * @param {boolean} hidden Whether balances are hidden
   */
  const waitingWhat = (send, hidden) =>
    waitingText(send, { hidden, locale: language });

  /**
   * Calls off a send that hasn't gone out, and says so, plainly: one that
   * went out meanwhile is no longer listed, as it's on its way.
   *
   * @param {import("$lib/transactions/waitingSends").WaitingSend} send
   */
  function cancelSend(send) {
    if (send.cancel(undefined)) {
      toast(
        "info",
        `Not sent: ${waitingWhat(send, $settingsStore.hideBalances)}. Nothing left your wallet.`,
        mdiCheck,
      );
    }
  }

  /**
   * Takes a send held for the person, as its account sent something else
   * while it waited, to Send's review, to send it from there: it's called
   * off here, and kept as not sent until it's sent there.
   *
   * @param {import("$lib/transactions/waitingSends").WaitingSend} send
   */
  function sendTooFromReview(send) {
    const kept = send.review();

    if (kept) {
      void reviewUnsent(kept);
    }
  }
</script>

<div class="home">
  <div class="home__main">
    <HomeBalance
      fiatCurrency={currency}
      fiatPrice={networkName === "mainnet" ? fiatPrice : undefined}
      locale={language}
      readAt={balanceReadAt}
      stakeReadAt={Number.isFinite(stakeLastRead) ? stakeLastRead : null}
      shielded={balance.shielded.value}
      staked={(staked ?? 0n) + liquid}
      {stakeReading}
      {stakeUnread}
      unread={balanceReadFailed}
      unshielded={balance.unshielded.value}
    />

    {#if actions.length}
      <HomeActions {actions} />
    {:else}
      <p class="home__note">Nothing can be sent from this wallet right now.</p>
    {/if}

    <!-- Sends that haven't gone out, as the network doesn't answer, or
      couldn't be reached: called off from here, or they go out once it
      answers. Each with its memo and when it was sent, to tell them apart,
      and one state at a time: not sent yet while it waits for the network,
      sending as it goes out, from when the node is asked to check it, and
      until the node answered its broadcast, with Cancel until the node is
      asked to broadcast it. One whose account sent something else while it
      waited goes out only as the person says so here. Once the node took it,
      Activity lists it. -->
    {#each $waitingSends as send (send.id)}
      {@const isSending =
        send.goesOut ||
        send.handedOver ||
        ($networkReach === "answering" && !send.waitsForNetwork)}
      {#if send.asks}
        <!-- What the account sent meanwhile, from the chain, once it's
          found, and whether it's the same payment. -->
        {@const told = sayMeanwhile(
          send.meanwhile
            ? $sentMeanwhileTold.get(meanwhileKey(send.meanwhile))
            : null,
          send,
          {
            checking: Boolean(
              send.meanwhile &&
              $sentMeanwhileChecking.has(meanwhileKey(send.meanwhile)),
            ),
            hidden: $settingsStore.hideBalances,
            locale: language,
            nameOf: $accountNamer,
          },
        )}
        <Banner
          className="home__waiting"
          role="status"
          title={told.title}
          variant="warning"
        >
          {#if told.memo}
            <p class="home__waiting-when">
              <MemoText inline text={told.memo} />
            </p>
          {/if}
          {#each told.items as item, i (i)}
            <p class="home__waiting-when">
              {item.text}{#if item.memo}
                · <MemoText inline text={item.memo} />{/if}
            </p>
          {/each}
          {#if told.same}
            <p>{told.same}</p>
          {/if}
          <p>
            Not sent yet: {waitingWhat(send, $settingsStore.hideBalances)}.
          </p>
          <p class="home__waiting-when">
            {#if send.memo}<MemoText inline text={send.memo} /> ·{/if}
            {timeLabel(send.at, language)}
          </p>
          <!-- Off while what it sent is read: the answer may be that it's
            this same payment. -->
          <div class="home__waiting-actions">
            <Button
              disabled={told.checking}
              on:click={() => sendTooFromReview(send)}
              size="small"
              text="Send it too"
              variant="secondary"
            />
            <Button
              disabled={told.checking}
              on:click={() => cancelSend(send)}
              size="small"
              text="Don't send"
              variant="tertiary"
            />
          </div>
        </Banner>
      {:else}
        <Banner
          className="home__waiting"
          role="status"
          title={`${isSending ? "Sending" : "Not sent yet"}: ${waitingWhat(send, $settingsStore.hideBalances)}.`}
          variant="info"
        >
          <p class="home__waiting-when">
            {#if send.memo}<MemoText inline text={send.memo} /> ·{/if}
            {timeLabel(send.at, language)}
          </p>
          {#if !isSending}
            <p>It goes out once the network answers.</p>
          {/if}
          {#if !send.handedOver}
            <Button
              className="home__waiting-cancel"
              on:click={() => cancelSend(send)}
              size="small"
              text="Cancel"
              variant="secondary"
            />
          {/if}
        </Banner>
      {/if}
    {/each}

    <!-- And those that never went out, as their page closed, reloaded or
      locked first: to send now, through Review, or not. -->
    <UnsentSends />

    {#if isEnabled("bridge") && migration}
      <p class="home__note">
        Have DUSK on Ethereum or BNB Smart Chain?
        <a
          class="text-link tap-link"
          href={resolve(`/dashboard/bridge/?route=${migration.id}`)}
          >Migrate it to Dusk</a
        >
      </p>
    {/if}
  </div>

  <div class="home__cards">
    <ExplainerCards
      {balanceReadAt}
      balanceUnread={balanceReadFailed}
      {hasPastStaking}
      {liquid}
      locale={language}
      {minimumStake}
      onRetry={readStakeAgain}
      reward={stakeInfo.reward}
      shielded={balance.shielded.value}
      sozuAvailable={sozuContractsFor(net) !== null}
      stakeEnabled={isEnabled("stake")}
      stakeReadAt={Number.isFinite(stakeLastRead) ? stakeLastRead : null}
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
          const session = walletStore.startHistory();

          session?.refresh().catch(() => {});
          session?.readMissing({ again: true });
        }}
        state={$activityState}
        whole={$wholeActivity}
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

  .home__waiting-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    margin-top: 0.5rem;
  }

  .home__waiting-when {
    color: var(--calm-muted);
    overflow-wrap: anywhere;
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
