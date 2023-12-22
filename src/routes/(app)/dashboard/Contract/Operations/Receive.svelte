<script>
	import { Button, QrCode } from "$lib/dusk/components";
	import { mdiArrowLeft, mdiContentCopy } from "@mdi/js";
	import { operationsStore } from "$lib/stores";

	/** @type {String} */
	export let publicSpendKey = "";

	/** @type {Boolean} */
	export let hideBackButton = false;

	let offsetHeight = 0;
	let receiveKeyHeight = 0;
	let buttonHeight = 0;

	const COLUMN_COUNT = 2;
	const COLUMN_WIDTH = 16;
	const BOTTOM_PADDING = 22;

	$: qrWidth = offsetHeight - receiveKeyHeight - buttonHeight
		- COLUMN_COUNT * COLUMN_WIDTH - BOTTOM_PADDING;
</script>

<div class="receive" bind:offsetHeight>
	<figure class="receive__psk">
		<QrCode
			value={publicSpendKey}
			className="receive__qr"
			width={qrWidth}
		/>

		<figcaption class="receive__key" bind:offsetHeight={receiveKeyHeight}>
			<samp>{publicSpendKey}</samp>
		</figcaption>
	</figure>

	<div class="receive__buttons" bind:offsetHeight={buttonHeight}>
		{#if !hideBackButton}
			<Button
				variant="tertiary"
				on:click={() =>
					operationsStore.update((store) => ({
						...store,
						currentOperation: undefined
					}))}
				className="flex-1"
				icon={{ path: mdiArrowLeft }}
				text="Back"
			/>
		{/if}
		<Button
			variant="tertiary"
			on:click={() => navigator.clipboard.writeText(publicSpendKey ?? "")}
			className="flex-1"
			icon={{ path: mdiContentCopy }}
			text="Copy"/>
	</div>
</div>

<style lang="postcss">
	.receive {
		position: absolute;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: space-between;
		gap: var(--default-gap);
		background-color: var(--background-color);
		top: 0;
		left: 0;
		z-index: 3;
		height: 100%;

		&__psk {
			display: flex;
			flex-direction: column;
			gap: var(--default-gap);
			align-items: center;
		}

		&__key, :global(&__qr) {
			border-radius: 1.5em;
			max-width: 100%;
			max-height: 100%;
		}

		&__key {
			line-break: anywhere;
			padding: 0.75em 1em;
			background-color: transparent;
			border: 1px solid var(--primary-color);
		}

		:global(&__qr) {
			padding: 0.625em;
			background-color: var(--background-color-alt);
		}

		&__buttons {
			display: flex;
			flex-direction: row;
			gap: var(--default-gap);
			width: 100%;
		}
	}
</style>
