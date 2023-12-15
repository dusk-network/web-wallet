<script>
	import { AnchorButton, Button, Icon } from "$lib/dusk/components";
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
	variant="secondary"
	size="small"
	text="VIEW ON BLOCK EXPLORER"
	on:click={() => resetOperationStore()}
/>
<Button variant="tertiary" text="HOME" on:click={() => resetOperationStore()}/>

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
