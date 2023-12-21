<script>
	import { AnchorButton, Icon } from "$lib/dusk/components";
	import { mdiCheckDecagramOutline } from "@mdi/js";
	import { operationsStore } from "$lib/stores";

	const resetOperationStore = () => {
		operationsStore.update((store) => ({
			...store,
			currentOperation: undefined
		}));
	};
</script>

<div class="operation__confirmation">
	<Icon
		className="operation-confirmation__icon"
		path={mdiCheckDecagramOutline}
	/>
	<p>Transaction Completed</p>
</div>

<AnchorButton
	href="https://explorer.dusk.network"
	on:click={resetOperationStore}
	rel="noopener noreferrer"
	target="_blank"
	text="VIEW ON BLOCK EXPLORER"
	variant="secondary"
/>
<AnchorButton
	href="/dashboard"
	on:click={event => {
		event.preventDefault();
		resetOperationStore();
	}}
	text="HOME"
	variant="tertiary"
/>

<style lang="postcss">
	.operation__confirmation {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--small-gap);
		padding: 20px 0;
	}

	:global(.operation-confirmation__icon) {
		width: 2em;
		height: 2em;
	}
</style>
