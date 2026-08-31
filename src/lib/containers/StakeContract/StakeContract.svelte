<svelte:options immutable={true} />

<script>
  import { Gas } from "@dusk/w3sper";
  import {
    gasStore,
    operationsStore,
    settingsStore,
    walletStore,
  } from "$lib/stores";
  import { ContractOperations, Stake, Unstake } from "$lib/components";
  import { mdiDatabaseArrowDownOutline, mdiGiftOpenOutline } from "@mdi/js";

  /** @type {ContractDescriptor} */
  export let descriptor;

  /** @type {ContractGasSettings} */
  export let gasSettings;

  /** @type {StakeInfo} */
  export let stakeInfo;

  /** @type {(value: number | bigint) => string} */
  export let formatter;

  /** @type {ContractOperation[]} */
  let operations;

  const gasLimits = $gasStore;
  const { hideStakingNotice } = $settingsStore;

  /** @type {Record<string, (info: StakeInfo) => boolean>} */
  const disablingConditions = {
    "claim-rewards": (info) => info.reward <= 0n,
    stake: (info) => !!info.amount,
    unstake: (info) => !info.amount || info.amount.total === 0n,
  };

  /** @type {Record<StakeType, (...args: any[]) => Promise<string>>} */
  const executeOperations = {
    "claim-rewards": (amount, gasPrice, gasLimit) =>
      walletStore
        .claimRewards(amount, new Gas({ limit: gasLimit, price: gasPrice }))
        .then(({ hash }) => hash),
    stake: (amount, gasPrice, gasLimit) =>
      walletStore
        .stake(amount, new Gas({ limit: gasLimit, price: gasPrice }))
        .then(({ hash }) => hash),
    unstake: (amount, gasPrice, gasLimit) =>
      walletStore
        .unstake(amount, new Gas({ limit: gasLimit, price: gasPrice }))
        .then(({ hash }) => hash),
  };

  /** @type {(operations: ContractOperation[]) => ContractOperation[]} */
  const disableAllOperations = (items) =>
    items.map((operation) => ({ ...operation, disabled: true }));

  /**
   * We want to update the disabled status ourselves only
   * when the operation is enabled in the descriptor;
   * otherwise the descriptor takes precedence.
   *
   * @returns {ContractOperation[]}
   */
  const getOperations = () =>
    descriptor.operations.map((operation) =>
      operation.disabled === false
        ? updateOperationDisabledStatus()(operation)
        : operation
    );

  const getMaxWithdrawAmount = () => {
    if (currentOperation === "unstake") {
      return stakeInfo.amount ? stakeInfo.amount.total : 0n;
    }

    return stakeInfo.reward;
  };
  /**
   * @returns {(operation: ContractOperation) => ContractOperation}
   */
  const updateOperationDisabledStatus = () => (operation) => ({
    ...operation,
    disabled: disablingConditions[operation.id]?.(stakeInfo) ?? true,
  });

  $: if (stakeInfo) {
    operations = getOperations();
  }
  $: ({ currentOperation } = $operationsStore);
  $: ({ balance, minimumStake, syncStatus } = $walletStore);
  $: isSyncOK = !(syncStatus.isInProgress || !!syncStatus.error);
  $: if (!isSyncOK) {
    disableAllOperations(descriptor.operations);
  }
</script>

{#key currentOperation}
  {#if currentOperation === "stake"}
    <Stake
      execute={executeOperations[currentOperation]}
      {formatter}
      {gasLimits}
      {gasSettings}
      minStakeRequirement={minimumStake}
      on:operationChange
      on:suppressStakingNotice
      availableBalance={balance.unshielded.value}
      {hideStakingNotice}
    />
  {:else if currentOperation === "unstake" || currentOperation === "claim-rewards"}
    <Unstake
      execute={executeOperations[currentOperation]}
      {formatter}
      {gasLimits}
      {gasSettings}
      on:operationChange
      maxWithdrawAmount={getMaxWithdrawAmount()}
      minStakeRequirement={currentOperation === "unstake"
        ? minimumStake
        : undefined}
      availableBalance={balance.unshielded.value}
      operationCtaLabel={currentOperation === "unstake"
        ? "Unstake"
        : "Claim Rewards"}
      operationCtaIconPath={currentOperation === "unstake"
        ? mdiDatabaseArrowDownOutline
        : mdiGiftOpenOutline}
      operationOverviewLabel={currentOperation === "unstake"
        ? "Unstake Amount"
        : "Rewards Amount"}
    />
  {:else}
    <ContractOperations items={operations} on:operationChange />
  {/if}
{/key}
