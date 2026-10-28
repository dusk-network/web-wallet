<svelte:options immutable={true} />

<script>
  import { onMount } from "svelte";
  import { page } from "$app/stores";
  import { Gas } from "@dusk/w3sper";
  import {
    mdiDatabaseArrowDownOutline,
    mdiDatabaseOutline,
    mdiGiftOpenOutline,
  } from "@mdi/js";

  import { activityState, isHistoryEnabled } from "$lib/activity";
  import { isStakingRow } from "$lib/activity/present";
  import { LiquidStake, NativeStake, Unstake } from "$lib/components";
  import { StakingOverview } from "$lib/containers";
  import { IconHeadingCard } from "$lib/containers/Cards";
  import { getGasLimits, getGasSettings } from "$lib/contracts";
  import { goto } from "$lib/navigation";
  import { sozuPools, sozuStore } from "$lib/sozu";
  import {
    gasPriceStore,
    gasStore,
    networkStore,
    settingsStore,
    walletStore,
  } from "$lib/stores";

  /** @type {Record<"claim" | "unstake", (amount: bigint, gasPrice: bigint, gasLimit: bigint) => Promise<string>>} */
  const withdrawals = {
    claim: (amount, gasPrice, gasLimit) =>
      walletStore
        .claimRewards(amount, new Gas({ limit: gasLimit, price: gasPrice }))
        .then(({ hash }) => hash),
    unstake: (amount, gasPrice, gasLimit) =>
      walletStore
        .unstake(amount, new Gas({ limit: gasLimit, price: gasPrice }))
        .then(({ hash }) => hash),
  };

  /**
   * @param {bigint} amount
   * @param {bigint} gasPrice
   * @param {bigint} gasLimit
   */
  const stakeNatively = (amount, gasPrice, gasLimit) =>
    walletStore[hasStake ? "topUpStake" : "stake"](
      amount,
      new Gas({ limit: gasLimit, price: gasPrice })
    ).then(({ hash }) => hash);

  /**
   * @param {"stake" | "unstake"} action
   * @param {string} poolId
   * @param {bigint} amount
   * @param {bigint} gasPrice
   * @param {bigint} gasLimit
   */
  const stakeLiquid = (action, poolId, amount, gasPrice, gasLimit) =>
    walletStore[action === "stake" ? "stakeWithSozu" : "unstakeFromSozu"](
      poolId,
      amount,
      new Gas({ limit: gasLimit, price: gasPrice })
    ).then(({ hash }) => hash);

  /** @type {bigint | undefined} */
  let blockHeight;

  onMount(() => {
    networkStore
      .getCurrentBlockHeight()
      .then((height) => {
        blockHeight = height;
      })
      .catch(() => {});
  });

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
  $: ({ balance, currentProfile, minimumStake, stakeInfo } = $walletStore);
  $: ({ networkName } = $networkStore);
  $: hasStake = stakeInfo.amount !== null;
  $: publicBalance = balance.unshielded.value;
  $: hasPastStaking = $activityState.rows.some((row) =>
    isStakingRow(row, $sozuPools)
  );

  // Sozu, read again for the overview each time it shows, as after a stake.
  $: if (flow === null && networkName && currentProfile) {
    void sozuStore.load({ force: true });
  } else if (flow === "liquid" && networkName && currentProfile) {
    void sozuStore.load();
  }

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
    />
  {:else if flow === "liquid" && isSozuAvailable}
    {#key liquidAction}
      <LiquidStake
        action={liquidAction}
        availableBalance={publicBalance}
        execute={stakeLiquid}
        gas={liquidGas}
        onRetry={() => sozuStore.load({ force: true })}
        recheck={() => sozuStore.check()}
        sozu={$sozuStore}
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
      locale={language}
      maxFee={unstakeGas.settings.gasLimit * unstakeGas.settings.gasPrice}
      {minimumStake}
      onRetryHistory={() => {
        walletStore
          .startHistory()
          ?.refresh()
          .catch(() => {});
      }}
      {publicBalance}
      sozu={$sozuStore}
      {stakeInfo}
    />
  {/if}
{/if}
