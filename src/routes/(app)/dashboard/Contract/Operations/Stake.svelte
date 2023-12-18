<script>
	import { mdiDatabaseArrowDownOutline, mdiDatabaseOutline } from "@mdi/js";
	import { fade } from "svelte/transition";

	import {
		Badge,
		Button,
		Icon,
		Textbox,
		Wizard,
		WizardStep
	} from "$lib/dusk/components";
	import { operationsStore, walletStore } from "$lib/stores";

	import StatusList from "$lib/dusk/components/StatusList/StatusList.svelte";
	import GasSettings from "./GasSettings/GasSettings.svelte";
	import StakeOverview from "./StakeOverview/StakeOverview.svelte";
	import TransactionComplete from "./TransactionComplete/TransactionComplete.svelte";

	/** @type {Status[]} */
	export let statuses;

	/** @type {Number} */
	let stakeAmount = 0;

	/** @type {StakeType} */
	export let flow;

	const resetOperationStore = () => {
		operationsStore.update((store) => ({
			...store,
			currentOperation: undefined
		}));
	};
</script>

<div class="operation">
	<Wizard fullHeight={true} steps={flow === "withdraw-rewards" ? 2 : 3} let:key>
		{#if flow !== "withdraw-rewards"}
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
			step={flow === "withdraw-rewards" ? 0 : 1}
			{key}
			backButton={ flow === "withdraw-rewards" ? {
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
				<GasSettings on:setGasSettings={() => {}}/>
			</div>
		</WizardStep>

		<WizardStep
			step={flow === "withdraw-rewards" ? 1 : 2}
			{key}
			showNavigation={false}>
			<TransactionComplete/>
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
		padding-right: var(--default-gap);
	}

	:global(.operation__input .operation__input-field) {
		width: 100%;
		padding: 0.5em 1em;
	}
</style>
