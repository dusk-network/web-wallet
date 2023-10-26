<svelte:options immutable={true}/>

<script>
	import { Button } from "$lib/dusk/components";
	import { mdiKeyOutline, mdiWalletOutline } from "@mdi/js";
</script>

<main class="flex flex-col gap-2">
	<h1>
		Unlocking the Future:<br/>
		Your <span class="accent-text">DUSK</span> native Wallet
	</h1>

	<div class="flex flex-col gap-1">
		<Button
			icon={{ path: mdiWalletOutline }}
			className="secondary"
			text="Create a new wallet"
		/>
		<Button
			icon={{ path: mdiKeyOutline }}
			className="tertiary"
			text="Restore wallet"
		/>
	</div>
</main>
