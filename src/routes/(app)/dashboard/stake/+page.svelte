<svelte:options immutable={true} />

<script>
  import { onDestroy } from "svelte";
  import { mdiDatabaseOutline } from "@mdi/js";
  import { StakeContract } from "$lib/containers";
  import { IconHeadingCard } from "$lib/containers/Cards";
  import { contractDescriptors, updateOperation } from "$lib/contracts";
  import { networkStore, settingsStore, walletStore } from "$lib/stores";
  import { formatDusk, formatDuskExact } from "$lib/dusk/currency";
  import { ContractStatusesList, StakeMaturityInfo } from "$lib/components";
  import { createNumberFormatter } from "$lib/dusk/number";

  /** @type {bigint} */
  let currentBlockHeight;

  /**
   * @param {keyof SettingsStoreContent} property
   * @param {any} value
   */
  function updateSetting(property, value) {
    settingsStore.update((store) => ({
      ...store,
      [property]: value,
    }));
  }

  onDestroy(() => {
    updateOperation("");
  });

  networkStore.getCurrentBlockHeight().then((blockHeight) => {
    currentBlockHeight = blockHeight;
  });

  $: numberFormatter = createNumberFormatter(language);

  /**
   * A status of an amount, in the one number format and in full on hover.
   *
   * @param {string} label
   * @param {bigint | undefined} lux
   * @param {string} locale
   * @returns {ContractStatus}
   */
  const amountStatus = (label, lux, locale) => ({
    exact: lux === undefined ? undefined : formatDuskExact(lux, locale),
    label,
    value: lux === undefined ? null : formatDusk(lux, locale),
  });

  $: ({ balance, stakeInfo } = $walletStore);
  $: ({ language } = $settingsStore);

  /** @returns {ContractStatus[]} */
  $: statuses = [
    amountStatus("Spendable", balance.unshielded.value, language),
    amountStatus("Active Stake", stakeInfo.amount?.value, language),
    amountStatus("Penalized Stake", stakeInfo.amount?.locked, language),
    amountStatus("Rewards", stakeInfo.reward, language),
  ];

  $: shouldShowStakeEligibility = stakeInfo.amount && currentBlockHeight;
</script>

{#if import.meta.env.VITE_FEATURE_STAKE || false}
  <IconHeadingCard
    gap="large"
    heading="Stake"
    icons={[mdiDatabaseOutline]}
    reverse
  >
    <ContractStatusesList {statuses}>
      {#if shouldShowStakeEligibility}
        <StakeMaturityInfo
          isParticipatingInConsensus={stakeInfo?.amount?.eligibility !==
            undefined && currentBlockHeight > stakeInfo.amount.eligibility}
          eligibility={stakeInfo?.amount?.eligibility ?? 0n}
          formatter={numberFormatter}
        />
      {/if}
    </ContractStatusesList>
    <StakeContract
      {stakeInfo}
      descriptor={contractDescriptors[2]}
      on:operationChange={({ detail }) => updateOperation(detail)}
      on:suppressStakingNotice={() => updateSetting("hideStakingNotice", true)}
    />
  </IconHeadingCard>
{/if}
