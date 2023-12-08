<script>
	import { mdiArrowLeft, mdiArrowRight } from "@mdi/js";
	import {
		Button, Icon, StatusList, Textbox
	} from "$lib/dusk/components";
	import { balanceStore, operationsStore } from "$lib/stores";

	/** @type {Status[]} */
	export let statuses;

	/** @type {Number} */
	let maxAmount = 0;

	function setMaxAmount () {
		maxAmount = $balanceStore.dusk;
	}
</script>

<div class="operation">
	<StatusList {statuses}/>
	<div class="operation__amount operation__space-between">
		<p>Enter amount:</p>
		<Button
			size="small"
			variant="tertiary"
			on:click={() => setMaxAmount()}
			text="USE MAX"
		/>
	</div>

	<div class="operation__amount operation__input">
		<Textbox
			className="operation__field"
			type="number"
			bind:value={maxAmount}
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

	<!-- To be removed after Wizard implemantation -->
	<div class="operation__amount operation__space-between">
		<Button
			variant="tertiary"
			on:click={() => operationsStore.update(store => ({ ...store, currentOperation: undefined }))}
			icon={{ path: mdiArrowLeft }}
			text="BACK"
		/>
		<Button
			variant="tertiary"
			on:click={() => {}}
			icon={{ path: mdiArrowRight }}
			text="NEXT"
		/>
	</div>
</div>

<style lang="postcss">
	.operation__amount {
		display: flex;
		align-items: center;
		width: 100%;
	}

	.operation__space-between {
		justify-content: space-between;
	}

	.operation__input {
		column-gap: var(--default-gap);
	}

	:global(.operation__input .operation__field) {
		width: 100%;
		padding: 0.5em 1em;
	}
</style>
