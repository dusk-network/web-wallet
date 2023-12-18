<script>
	import { Button, QrCode } from "$lib/dusk/components";
	import { mdiArrowLeft, mdiContentCopy } from "@mdi/js";
	import { operationsStore } from "$lib/stores";

	/** @type {String} */
	export let publicSpendKey = "";

	/** @type {Boolean} */
	export let hideBackButton = false;

	const SCALING_FACTOR = 0.31;

	let innerWidth = 0;
	let innerHeight = 0;
</script>

<svelte:window bind:innerHeight bind:innerWidth/>

<div class="receive">
	<figure class="receive__psk">
		<QrCode
			value={publicSpendKey}
			className="receive__qr"

			height={innerHeight * SCALING_FACTOR}
		/>

		<figcaption class="receive__key">
			<samp>{publicSpendKey}</samp>
		</figcaption>
	</figure>

	<div class="receive__buttons">
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
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--default-gap);

		&__psk {
			display: flex;
			flex-direction: column;
			gap: var(--default-gap);
			align-items: center;
			flex: 1;
		}

		&__key, :global(&__qr) {
			border-radius: 1.5em;
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
			min-width: auto;
		}

		&__buttons {
			display: flex;
			flex-direction: row;
			gap: var(--default-gap);
			width: 100%;
		}
	}
</style>
