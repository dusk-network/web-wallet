<script>
	import { fade } from "svelte/transition";
	import {
		AnchorButton,
		Badge,
		Button,
		Icon,
		StatusList,
		Wizard,
		WizardStep
	} from "$lib/dusk/components";
	import { operationsStore } from "$lib/stores";
	import { mdiCheckDecagramOutline, mdiDatabaseOutline } from "@mdi/js";
	import GasSettings from "./GasSettings/GasSettings.svelte";
	import StakeRewards from "./StakeRewards/StakeRewards.svelte";

	/** @type {Status[]} */
	export let statuses;

	const resetOperationStore = () => {
		operationsStore.update((store) => ({
			...store,
			currentOperation: undefined
		}));
	};
</script>

<div class="operation">
	<Wizard steps={3} let:key>
		<WizardStep
			step={0}
			{key}
			backButton={{
				action: () => resetOperationStore(),
				disabled: false
			}}
		>
			<div in:fade|global class="operation__rewards">
				<StatusList {statuses}/>
				<StakeRewards {statuses}/>
			</div>
		</WizardStep>
		<WizardStep
			step={1}
			{key}
			nextButton={{
				icon: {
					path: mdiDatabaseOutline,
					position: "before"
				},
				label: "STAKE",
				variant: "secondary"
			}}
		>
			<div in:fade|global class="operation__rewards">
				<StatusList {statuses}/>
				<Badge
					className="operation__rewards__notice"
					text="REVIEW TRANSACTION"
					variant="warning"
				/>
				<StakeRewards {statuses}/>
				<GasSettings on:setGasSettings={() => {}}/>
			</div>
		</WizardStep>
		<WizardStep step={2} {key} showNavigation={false}>
			<div class="operation__confirmation">
				<Icon
					className="operation__confirmation__icon"
					path={mdiCheckDecagramOutline}
				/>
				<p>Transaction Completed.</p>
			</div>
			<AnchorButton
				href="https://explorer.dusk.network"
				variant="secondary"
				size="small"
				text="VIEW ON BLOCK EXPLORER"
				on:click={() => resetOperationStore()}
			/>
			<Button
				variant="tertiary"
				text="HOME"
				on:click={() => resetOperationStore()}
			/>
		</WizardStep>
	</Wizard>
</div>

<style lang="postcss">
	.operation__rewards {
		display: flex;
		flex-direction: column;
		gap: 1.2em;
	}

	.operation__confirmation {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--small-gap);
		padding: 20px 0;
	}

	:global(.operation__confirmation__icon) {
		width: 2em;
		height: 2em;
	}

	:global(.dusk-rewards__icon) {
		width: 0.8em;
		height: 0.8em;
		flex-shrink: 0;
	}

	:global(.operation__rewards__notice) {
		display: block;
		text-align: center;
	}
</style>
