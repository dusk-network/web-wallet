<script>
	import { Button, QrCode } from "$lib/dusk/components";
	import { mdiArrowLeft, mdiContentCopy } from "@mdi/js";
	import { operationsStore } from "$lib/stores";

	/** @type {String} */
	export let publicSpendKey = "";

	const QR_MIN_WIDTH = 150;
	const QR_MAX_WIDTH = 520;

	let offsetWidth = 0;

	$: qrWidth = Math.min(
		Math.max(
			Math.round(offsetWidth),
			QR_MIN_WIDTH
		),
		QR_MAX_WIDTH
	);

</script>

<div class="receive" bind:offsetWidth>
	<figure class="receive__psk">
		<QrCode
			value={publicSpendKey}
			className="receive__qr"
			width={qrWidth}
		/>

		<figcaption class="receive__key">
			<samp>{publicSpendKey}</samp>
		</figcaption>
	</figure>

	<div class="receive__buttons">
		<Button
			variant="tertiary"
			on:click={() => operationsStore.update(store => ({ ...store, currentOperation: undefined }))}
			className="flex-1"
			icon={{ path: mdiArrowLeft }}
			text="Back"/>
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
		}

		&__key, :global(&__qr) {
			background-color: var(--background-color-alt);
			border-radius: 2em;
			width: 100%;
		}

		&__key {
			line-break: anywhere;
			padding: 0.5em 1em;
		}

		:global(&__qr) {
			padding: 0.625em;
		}

		&__buttons {
			display: flex;
			flex-direction: row;
			gap: var(--default-gap);
			width: 100%;
		}
	}
</style>
