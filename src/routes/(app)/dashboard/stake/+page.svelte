<svelte:options immutable={true} />

<script>
  import { onDestroy, onMount } from "svelte";
  import { get } from "svelte/store";
  import { page } from "$app/stores";
  import { Gas } from "@dusk/w3sper";
  import {
    mdiDatabaseArrowDownOutline,
    mdiDatabaseOutline,
    mdiGiftOpenOutline,
  } from "@mdi/js";

  import {
    activityState,
    currentActivity,
    isHistoryEnabled,
  } from "$lib/activity";
  import {
    exportCurrency,
    followRewardsByYear,
  } from "$lib/activity/accountantExport";
  import { LiquidStake, NativeStake, Unstake } from "$lib/components";
  import { StakingOverview } from "$lib/containers";
  import { IconHeadingCard } from "$lib/containers/Cards";
  import { getGasLimits, getGasSettings } from "$lib/contracts";
  import { goto } from "$lib/navigation";
  import { hasPrice } from "$lib/prices";
  import { readSozuGrowth, sozuStore } from "$lib/sozu";
  import { followTransaction } from "$lib/transactions";
  import { readNativeRewards, readProvisioners } from "$lib/staking/rewardRate";
  import { nodeBaseUrl } from "$lib/url";
  import {
    gasPriceStore,
    gasStore,
    networkStore,
    settingsStore,
    walletStore,
  } from "$lib/stores";

  // What this page sends, it sends from the wallet it was drawn for.
  const forThisWallet = walletStore.forThisWallet();

  /** @type {Record<"claim" | "unstake", (amount: bigint, gasPrice: bigint, gasLimit: bigint) => Promise<string>>} */
  const withdrawals = {
    claim: forThisWallet((amount, gasPrice, gasLimit) =>
      walletStore
        .claimRewards(amount, new Gas({ limit: gasLimit, price: gasPrice }))
        .then(({ hash }) => hash)
    ),
    unstake: forThisWallet((amount, gasPrice, gasLimit) =>
      walletStore
        .unstake(amount, new Gas({ limit: gasLimit, price: gasPrice }))
        .then(({ hash }) => hash)
    ),
  };

  const stakeNatively = forThisWallet(
    /**
     * @param {bigint} amount
     * @param {bigint} gasPrice
     * @param {bigint} gasLimit
     */
    (amount, gasPrice, gasLimit) =>
      walletStore[hasStake ? "topUpStake" : "stake"](
        amount,
        new Gas({ limit: gasLimit, price: gasPrice })
      ).then(({ hash }) => hash)
  );

  /**
   * The stakes and unstakes with Sozu on their way that this page follows,
   * by hash.
   *
   * @type {Record<string, true>}
   */
  const followed = {};

  const stakeLiquid = forThisWallet(
    /**
     * @param {"stake" | "unstake"} action
     * @param {string} poolId
     * @param {bigint} amount
     * @param {bigint} gasPrice
     * @param {bigint} gasLimit
     */
    (action, poolId, amount, gasPrice, gasLimit) =>
      walletStore[action === "stake" ? "stakeWithSozu" : "unstakeFromSozu"](
        poolId,
        amount,
        new Gas({ limit: gasLimit, price: gasPrice })
      ).then(({ hash }) => {
        // Its Sent screen follows it from here.
        followed[hash] = true;
        void sozuStore.readAfter(hash);

        return hash;
      })
  );

  /**
   * Follows what this profile sent to Sozu that's on its way, as after a
   * reload while it went, as its Sent screen would have: once it's final, the
   * history and the balances with Sozu (`readWithBalances`), shown together,
   * are read again, for what the form leaves out to come back in, and the
   * form's position from the history read then.
   *
   * @param {ActivityRow[]} rows
   */
  function followUnderWay(rows) {
    for (const { hash } of rows) {
      if (!followed[hash]) {
        followed[hash] = true;
        void followTransaction(hash)
          .catch(() => null)
          .then(async (final) => {
            if (final) {
              void walletStore.refreshBalance();
              await Promise.resolve(currentActivity()?.refresh()).catch(
                () => {}
              );

              if (sozuFormFor) {
                readSozuHistory();
              }
            }
          });
      }
    }
  }

  /** @type {bigint | undefined} */
  let blockHeight;

  /**
   * What native staking pays a year: measured over its last days, or else
   * estimated, read once a day.
   *
   * @type {Awaited<ReturnType<typeof readNativeRewards>> | undefined}
   */
  let native;

  // The gas price as the network asks it now, for what's sent from here.
  onMount(() => {
    gasPriceStore.readAgain();
  });

  onMount(() => {
    networkStore
      .getCurrentBlockHeight()
      .then((height) => {
        blockHeight = height;
      })
      .catch(() => {});
    void readNativeRewards({
      network: String(get(networkStore).networkName ?? ""),
      nodeUrl: nodeBaseUrl(),
      tipHeight: () => networkStore.getCurrentBlockHeight(),
    }).then((read) => {
      native = read;
    });
  });

  /**
   * Staking rewards by year, as Export gives them, for the overview, as the
   * extension's Stake shows them: the profile's, read again while a new
   * stake's or unstake's facts aren't, and with their value once asked.
   *
   * @type {(Awaited<ReturnType<typeof import("$lib/activity/accountantExport").readRewardsByYear>> & { of: string }) | null}
   */
  let rewards = null;

  /** Whether they're read with their value. */
  let rewardsValued = false;

  /** What they were read for last: "" for nothing. */
  let rewardsFor = "";

  /** @type {() => void} */
  let stopRewards = () => {};

  onDestroy(() => stopRewards());

  /**
   * Reads them for the overview shown, the profile, the network and whether
   * they're valued, each once; for nothing, it stops.
   *
   * @param {string} key
   */
  function readRewards(key) {
    if (key === rewardsFor) {
      return;
    }

    rewardsFor = key;
    stopRewards();
    stopRewards = () => {};

    /** @type {ReturnType<typeof walletStore.startHistory>} */
    let session = null;

    try {
      session = key ? walletStore.startHistory() : null;
    } catch {
      // No profile's history to read.
    }

    if (!session) {
      return;
    }

    const of = String(currentProfile?.account ?? "");

    stopRewards = followRewardsByYear(
      {
        currency: rewardsCurrency,
        fiat: rewardsValued,
        net: get(networkStore).net,
        session,
        sozuStatus: () => sozuStore.check(),
      },
      {
        // Nothing to show of what couldn't be read: History's Export says why.
        onError: () => {},
        onRead: (read) => {
          if (rewardsFor === key) {
            rewards = { ...read, of };
          }
        },
      }
    );
  }

  /**
   * How Sozu's stDUSK grew lately, for its status read: one figure for the
   * form and the overview alike, null where it can't be read.
   *
   * @type {import("@dusk-network/app-core/sozu").SozuGrowth | null}
   */
  let sozuGrowth = null;

  /** @type {SozuStatus | null} */
  let growthFor = null;

  /**
   * Reads Sozu's growth for a status, keeping only the answer for the last.
   *
   * @param {SozuStatus | null} status
   */
  function readGrowthFor(status) {
    if (!status || status === growthFor) {
      return;
    }

    growthFor = status;
    void readSozuGrowth({
      nodeUrl: nodeBaseUrl(),
      status,
      tipHeight: blockHeight,
    }).then((growth) => {
      if (growthFor === status) {
        sozuGrowth = growth;
      }
    });
  }

  $: readGrowthFor($sozuStore.status);

  /** What the node says of what's staked: for the Sozu form's working. */
  /** @type {any[] | null} */
  let provisioners = null;

  /**
   * What the profile did with Sozu, as its form shows it.
   *
   * @type {{ facts?: Map<string, import("@dusk-network/app-core/sozu").SozuFact>, reading: boolean, rows: ActivityRow[], whole?: boolean }}
   */
  let sozuHistory = { reading: false, rows: [] };

  /**
   * Reads the profile's whole history for its position with Sozu, as its form
   * opens: an answer for a profile before this one counts for nothing.
   */
  function readSozuHistory() {
    if (!isHistoryEnabled()) {
      return;
    }

    const asked = { reading: true, rows: [] };

    sozuHistory = asked;
    Promise.resolve()
      .then(async () => {
        const session = /** @type {import("$lib/activity").ActivitySession} */ (
          walletStore.startHistory()
        );
        const { rows } = await session.whole({ publicOnly: true });
        const facts = await session.sozuFacts(rows).catch(() => undefined);

        return { facts, reading: false, rows, whole: true };
      })
      .catch(() => ({ reading: false, rows: [] }))
      .then((read) => {
        if (sozuHistory === asked) {
          sozuHistory = read;
        }
      });
  }

  /**
   * Reads what the Sozu form shows that's not Sozu's own, as it opens.
   *
   * @param {string} account The profile's it opens for: "" while it's closed
   */
  function readSozuFigures(account) {
    if (account) {
      readSozuHistory();
      void readProvisioners({ nodeUrl: nodeBaseUrl() }).then((read) => {
        provisioners = read;
      });
    }
  }

  /**
   * What liquid staking opens on: a stake, or an unstake.
   *
   * @param {URL} pageUrl
   * @returns {"stake" | "unstake"}
   */
  const actionOf = (pageUrl) =>
    pageUrl.searchParams.get("action") === "unstake" ? "unstake" : "stake";

  /**
   * The gas an operation starts from, and its bounds.
   *
   * @param {GasOperation} operation
   * @param {Pick<SettingsStoreContent, "customGasLimit" | "customGasPrice">} custom
   * @param {GasStoreContent} bounds
   * @param {bigint} nodePrice
   */
  const gasFor = (operation, custom, bounds, nodePrice) => ({
    limits: getGasLimits(operation, bounds),
    settings: getGasSettings(operation, custom, nodePrice),
  });

  $: ({ url } = $page);
  $: flow = url.searchParams.get("flow");
  $: liquidAction = actionOf(url);
  $: ({ customGasLimit, customGasPrice, language } = $settingsStore);
  $: ({ balance, currentProfile, minimumStake, pendingStakes, stakeInfo } =
    $walletStore);
  // A staking transaction this profile sent waits to settle: Staking's
  // buttons wait with it, or, once the wallet stopped waiting, its amounts
  // may be out of date.
  $: ownStakes = pendingStakes.filter(
    ({ account }) => account === String(currentProfile?.account)
  );
  $: isStakePending = ownStakes.some(({ stale }) => !stale);
  $: isStakeStale = ownStakes.some(({ stale }) => stale);
  $: ({ networkName } = $networkStore);
  $: hasStake = stakeInfo.amount !== null;
  $: publicBalance = balance.unshielded.value;
  $: hasPastStaking = $activityState.rows.some(
    (row) => row.category === "staking"
  );
  // In the wallet's currency, as Export values them.
  $: rewardsCurrency = exportCurrency(
    $settingsStore.currency,
    navigator.language
  );
  // Another profile's aren't this one's.
  $: if (rewards && rewards.of !== String(currentProfile?.account ?? "")) {
    rewards = null;
  }
  $: readRewards(
    flow === null &&
      isHistoryEnabled() &&
      hasPastStaking &&
      currentProfile &&
      networkName
      ? [currentProfile.account, networkName, rewardsCurrency, rewardsValued]
          .map(String)
          .join("|")
      : ""
  );
  // What the profile sent to Sozu that isn't in a block yet.
  $: sozuUnderWay = $activityState.rows.filter(
    (row) => row.sozu && row.source === "sent" && row.status === "pending"
  );
  $: followUnderWay(sozuUnderWay);

  // Sozu, read again for the overview each time it shows, as after a stake.
  $: if (flow === null && networkName && currentProfile) {
    void sozuStore.load({ force: true });
  } else if (flow === "liquid" && networkName && currentProfile) {
    void sozuStore.load();
  }

  // Each time its form opens, as after a stake, for each profile.
  $: sozuFormFor =
    flow === "liquid" && isSozuAvailable && currentProfile
      ? String(currentProfile.account)
      : "";
  $: readSozuFigures(sozuFormFor);

  $: custom = { customGasLimit, customGasPrice };
  $: unstakeGas = gasFor(
    flow === "claim" ? "claim-rewards" : "unstake",
    custom,
    $gasStore,
    $gasPriceStore
  );
  $: stakeGas = gasFor("stake", custom, $gasStore, $gasPriceStore);
  // A stake with Sozu and an unstake from it each have their own gas.
  $: liquidGas = {
    stake: gasFor("liquid-stake", custom, $gasStore, $gasPriceStore),
    unstake: gasFor("liquid-unstake", custom, $gasStore, $gasPriceStore),
  };
  $: ({ available: isSozuAvailable } = $sozuStore);
</script>

{#if import.meta.env.VITE_FEATURE_STAKE || false}
  {#if flow === "native"}
    <NativeStake
      availableBalance={publicBalance}
      execute={stakeNatively}
      gasLimits={stakeGas.limits}
      gasSettings={stakeGas.settings}
      {hasStake}
      liquidHref={isSozuAvailable ? "/dashboard/stake?flow=liquid" : undefined}
      {minimumStake}
      unstakeFee={unstakeGas.settings.gasLimit * unstakeGas.settings.gasPrice}
    />
  {:else if flow === "liquid" && isSozuAvailable}
    {#key liquidAction}
      <LiquidStake
        action={liquidAction}
        availableBalance={publicBalance}
        execute={stakeLiquid}
        gas={liquidGas}
        history={sozuHistory}
        onRetry={() => sozuStore.load({ force: true })}
        rates={{
          growth: sozuGrowth,
          native: native?.rate,
          nativeRewards: native?.native ?? null,
          provisioners,
          tipHeight: blockHeight,
        }}
        recheck={() => sozuStore.check()}
        sozu={$sozuStore}
        underWay={sozuUnderWay}
      />
    {/key}
  {:else if flow === "unstake" || flow === "claim"}
    <!-- A flow of its own, laid out as the other one-column flows. -->
    <div class="dashboard--column">
      <IconHeadingCard
        gap="large"
        heading={flow === "unstake" ? "Unstake" : "Claim rewards"}
        icons={[mdiDatabaseOutline]}
        reverse
      >
        <Unstake
          availableBalance={publicBalance}
          execute={withdrawals[flow]}
          gasLimits={unstakeGas.limits}
          gasSettings={unstakeGas.settings}
          maxWithdrawAmount={flow === "unstake"
            ? (stakeInfo.amount?.total ?? 0n)
            : stakeInfo.reward}
          minStakeRequirement={flow === "unstake" ? minimumStake : undefined}
          on:operationChange={() => goto("/dashboard/stake")}
          operationCtaIconPath={flow === "unstake"
            ? mdiDatabaseArrowDownOutline
            : mdiGiftOpenOutline}
          operationCtaLabel={flow === "unstake" ? "Unstake" : "Claim rewards"}
          operationOverviewLabel={flow === "unstake"
            ? "Amount to unstake"
            : "Rewards to claim"}
        />
      </IconHeadingCard>
    </div>
  {:else}
    <StakingOverview
      activity={isHistoryEnabled() ? $activityState : null}
      {blockHeight}
      {hasPastStaking}
      nativeDays={native?.days ?? null}
      nativeRate={native?.rate}
      {sozuGrowth}
      locale={language}
      leastFee={unstakeGas.limits.gasLimitLower *
        unstakeGas.limits.gasPriceLower}
      maxFee={unstakeGas.settings.gasLimit * unstakeGas.settings.gasPrice}
      {minimumStake}
      pending={isStakePending}
      stale={isStakeStale}
      onRetryHistory={() => {
        walletStore
          .startHistory()
          ?.refresh()
          .catch(() => {});
      }}
      onRetrySozu={() => sozuStore.load({ force: true })}
      {publicBalance}
      {rewards}
      {rewardsCurrency}
      rewardsPriced={hasPrice($networkStore.net)}
      bind:rewardsValued
      sozu={$sozuStore}
      {stakeInfo}
      stakeReadFailed={$walletStore.stakeReadFailed}
    />
  {/if}
{/if}
