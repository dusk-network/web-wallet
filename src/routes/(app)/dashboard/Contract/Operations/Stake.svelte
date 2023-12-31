<script>
	import { mdiDatabaseArrowDownOutline, mdiDatabaseOutline } from "@mdi/js";
	import { fade } from "svelte/transition";

	import {
		AnchorButton,
		Badge,
		Button,
		Icon,
		Textbox,
		Wizard,
		WizardStep
	} from "$lib/dusk/components";
	import { operationsStore, settingsStore, walletStore } from "$lib/stores";
	import { getLastTransactionHash } from "$lib/transactions";

	import StatusList from "$lib/dusk/components/StatusList/StatusList.svelte";
	import GasSettings from "./GasSettings/GasSettings.svelte";
	import StakeOverview from "./StakeOverview/StakeOverview.svelte";
	import OperationResult from "./OperationResult/OperationResult.svelte";

	/** @type {Status[]} */
	export let statuses;

	/** @type {Number} */
	let stakeAmount = 1000;

	/** @type {StakeType} */
	export let flow;

	const getStatusValue = (/** @type {string} */ label) => {
		const currentStatus = statuses.find(status => status.key.label === label);

		return currentStatus?.value.value ?? 0;
	};

	if (flow === "withdraw-stake") {
		stakeAmount = getStatusValue("Total Locked");
	} else if (flow === "withdraw-rewards") {
		stakeAmount = getStatusValue("Rewards");
	}

	const resetOperationStore = () => {
		operationsStore.update((store) => ({
			...store,
			currentOperation: undefined
		}));
	};

	$: ({
		gasLimit,
		gasLimitLower,
		gasLimitUpper,
		gasPrice,
		gasPriceLower
	} = $settingsStore);

	async function stake () {
		switch (flow) {
			case "stake":
				await walletStore.stake(stakeAmount);
				break;

			case "withdraw-stake":
				await walletStore.unstake();
				break;

			case "withdraw-rewards":
				await walletStore.withdrawReward();
				break;

			default:
				break;
		}
	}
</script>

<div class="operation">
	<Wizard steps={flow === "stake" ? 3 : 2} let:key>
		{#if flow === "stake"}
			<WizardStep
				step={0}
				{key}
				backButton={{
					action: () => resetOperationStore(),
					disabled: false
				}}
				nextButton={{ disabled: stakeAmount === 0 }}>
				<StatusList {statuses}/>
				<div class="operation__amount operation__space-between">
					<p>Enter amount:</p>
					<Button
						size="small"
						variant="tertiary"
						on:click={() => {
							const { balance } = $walletStore;

							stakeAmount = balance.maximum;
						}}
						text="USE MAX"
					/>
				</div>

				<div class="operation__amount operation__input">
					<Textbox
						className="operation__input-field"
						type="number"
						bind:value={stakeAmount}
						min={1000}
					/>
					{#if statuses[0]?.value?.icon}
						<Icon
							className="dusk-status__icon"
							path={statuses[0].value.icon.path ?? ""}
							data-tooltip-id={statuses[0].value.icon.label
								&& "status-tooltip"}
							data-tooltip-text={statuses[0].value.icon.label ?? ""}
							data-tooltip-place="top"
						/>
					{/if}
				</div>
			</WizardStep>
		{/if}

		<WizardStep
			step={flow === "stake" ? 1 : 0}
			{key}
			backButton={ flow !== "stake" ? {
				action: () => resetOperationStore(),
				disabled: false
			} : undefined}
			nextButton={{
				disabled: stakeAmount === 0,
				icon: {
					path: flow === "stake" ? mdiDatabaseOutline : mdiDatabaseArrowDownOutline,
					position: "before"
				},
				label: flow === "stake" ? "STAKE" : "WITHDRAW",
				variant: "secondary"
			}}>
			<div in:fade|global class="operation__stake">
				<StatusList {statuses}/>
				<Badge
					className="operation__rewards-notice"
					text="REVIEW TRANSACTION"
					variant="warning"
				/>
				<StakeOverview amount={stakeAmount} {flow}/>
				<GasSettings
					limit={gasLimit}
					limitLower={gasLimitLower}
					limitUpper={gasLimitUpper}
					price={gasPrice}
					priceLower={gasPriceLower}
					on:setGasSettings={(event) => {
						settingsStore.update(store => {
							store.gasLimit = event.detail.limit;
							store.gasPrice = event.detail.price;

							return store;
						});
					}}
				/>
			</div>
		</WizardStep>

		<WizardStep
			step={flow === "stake" ? 2 : 1}
			{key}
			showNavigation={false}>

			<OperationResult
				errorMessage="Transaction Failed"
				onBeforeLeave={resetOperationStore}
				operation={stake().then(getLastTransactionHash)}
				pendingMessage="Processing transaction"
				successMessage="Transaction completed"
			>
				<svelte:fragment slot="success-content" let:result={hash}>
					{#if hash}
						<AnchorButton
							href={`https://explorer.dusk.network/transactions/transaction?id=${hash}`}
							on:click={resetOperationStore}
							rel="noopener noreferrer"
							target="_blank"
							text="VIEW ON BLOCK EXPLORER"
							variant="secondary"
						/>
					{/if}
				</svelte:fragment>
			</OperationResult>
		</WizardStep>
	</Wizard>
</div>

<style lang="postcss">
	.operation__amount {
		display: flex;
		align-items: center;
		width: 100%;
	}

	.operation__stake {
		display: flex;
		flex-direction: column;
		gap: 1.2em;
	}

	.operation__space-between {
		justify-content: space-between;
	}

	.operation__input {
		column-gap: var(--default-gap);
	}

	:global(.operation__input .operation__input-field) {
		width: 100%;
		padding: 0.5em 1em;
	}
</style>
